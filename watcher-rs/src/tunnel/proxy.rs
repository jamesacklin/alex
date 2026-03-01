use crate::tunnel::protocol::Frame;
use anyhow::{Context, Result};
use http_body_util::BodyExt;
use hyper::body::Incoming;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use tokio::sync::mpsc;

const CHUNK_SIZE: usize = 64 * 1024; // 64 KB

/// Forward an HttpRequest frame to the local server and stream the response back.
pub async fn forward_request(
    frame_tx: &mpsc::Sender<Frame>,
    request_id: u64,
    method: String,
    uri: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    local_addr: &str,
) -> Result<()> {
    let client: Client<_, http_body_util::Full<hyper::body::Bytes>> =
        Client::builder(TokioExecutor::new()).build_http();

    let url = format!("http://{local_addr}{uri}");

    let mut builder = hyper::Request::builder().method(method.as_str()).uri(&url);

    for (key, value) in &headers {
        // Skip the host header since we're rewriting the target
        if key.eq_ignore_ascii_case("host") {
            continue;
        }
        builder = builder.header(key.as_str(), value.as_str());
    }
    // Set host to local address
    builder = builder.header("host", local_addr);

    let req = builder
        .body(http_body_util::Full::new(hyper::body::Bytes::from(body)))
        .context("failed to build request")?;

    let resp = match client.request(req).await {
        Ok(r) => r,
        Err(e) => {
            // Send a 502 response back through the tunnel
            let _ = frame_tx
                .send(Frame::HttpResponse {
                    request_id,
                    status: 502,
                    headers: vec![("content-type".to_string(), "text/plain".to_string())],
                })
                .await;
            let _ = frame_tx
                .send(Frame::ResponseChunk {
                    request_id,
                    data: format!("local server error: {e}").into_bytes(),
                })
                .await;
            let _ = frame_tx.send(Frame::ResponseEnd { request_id }).await;
            return Ok(());
        }
    };

    // Send response headers
    let status = resp.status().as_u16();
    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    frame_tx
        .send(Frame::HttpResponse {
            request_id,
            status,
            headers: resp_headers,
        })
        .await
        .ok();

    // Stream body in chunks
    let mut body = resp.into_body();
    let mut buf = Vec::with_capacity(CHUNK_SIZE);

    while let Some(frame_result) = body.frame().await {
        match frame_result {
            Ok(frame) => {
                if let Some(data) = frame.data_ref() {
                    buf.extend_from_slice(data);
                    while buf.len() >= CHUNK_SIZE {
                        let chunk: Vec<u8> = buf.drain(..CHUNK_SIZE).collect();
                        frame_tx
                            .send(Frame::ResponseChunk {
                                request_id,
                                data: chunk,
                            })
                            .await
                            .ok();
                    }
                }
            }
            Err(e) => {
                eprintln!("error reading response body: {e}");
                break;
            }
        }
    }

    // Flush remaining data
    if !buf.is_empty() {
        frame_tx
            .send(Frame::ResponseChunk {
                request_id,
                data: buf,
            })
            .await
            .ok();
    }

    frame_tx.send(Frame::ResponseEnd { request_id }).await.ok();

    Ok(())
}
