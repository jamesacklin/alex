use crate::protocol::Frame;
use crate::relay::{RelayState, ResponseBodyEvent};
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, Response, StatusCode};
use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::sync::oneshot;
use tracing::warn;

/// Handle an incoming HTTP request by forwarding it to the appropriate tunnel client.
pub async fn proxy_request(
    State(state): State<Arc<RelayState>>,
    req: Request<Body>,
) -> Response<Body> {
    // Extract subdomain from Host header
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let subdomain = match state.extract_subdomain(host) {
        Some(s) => s,
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("no tunnel found"))
                .unwrap();
        }
    };

    // Look up the client
    let client = match state.clients.get(&subdomain) {
        Some(c) => c,
        None => {
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("tunnel not connected"))
                .unwrap();
        }
    };

    // Assign request ID
    let request_id = client.next_request_id.fetch_add(1, Ordering::Relaxed);

    // Collect request headers
    let headers: Vec<(String, String)> = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let method = req.method().to_string();
    let uri = req.uri().to_string();

    // Read request body
    let body_bytes = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b.to_vec(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("request body too large"))
                .unwrap();
        }
    };

    // Set up response channel
    let (resp_tx, resp_rx) = oneshot::channel();
    client.pending.insert(request_id, resp_tx);

    // Send HttpRequest frame to client
    let frame = Frame::HttpRequest {
        request_id,
        method,
        uri,
        headers,
        body: body_bytes,
    };

    if client.tx.send(frame).await.is_err() {
        client.pending.remove(&request_id);
        return Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .body(Body::from("tunnel client disconnected"))
            .unwrap();
    }

    // Drop the reference to allow the client to be cleaned up if it disconnects
    drop(client);

    // Wait for response (with timeout)
    let collector = match tokio::time::timeout(std::time::Duration::from_secs(120), resp_rx).await
    {
        Ok(Ok(c)) => c,
        Ok(Err(_)) => {
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("tunnel client dropped request"))
                .unwrap();
        }
        Err(_) => {
            warn!(request_id, "request timed out");
            return Response::builder()
                .status(StatusCode::GATEWAY_TIMEOUT)
                .body(Body::from("tunnel request timed out"))
                .unwrap();
        }
    };

    // Build response
    let mut response = Response::builder().status(collector.status);

    if let Some(headers_mut) = response.headers_mut() {
        for (key, value) in &collector.headers {
            if let (Ok(name), Ok(val)) = (
                HeaderName::try_from(key.as_str()),
                HeaderValue::try_from(value.as_str()),
            ) {
                headers_mut.insert(name, val);
            }
        }
    }

    // Stream body chunks
    let body_rx = collector.body_rx;
    let stream = async_stream::stream! {
        let mut body_rx = body_rx;
        while let Some(event) = body_rx.recv().await {
            match event {
                ResponseBodyEvent::Chunk(data) => {
                    yield Ok::<_, std::convert::Infallible>(data);
                }
                ResponseBodyEvent::End => break,
            }
        }
    };

    response
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("failed to build response"))
                .unwrap()
        })
}
