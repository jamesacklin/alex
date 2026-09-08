use crate::tunnel::protocol::Frame;
use anyhow::{Context, Result};
use http_body_util::BodyExt;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use tokio::sync::mpsc;

/// Largest body slice carried in a single `ResponseChunk` frame.
///
/// This is a *ceiling*, not a target: whatever the local server produces is
/// forwarded immediately and only split when it exceeds this size. The
/// previous implementation accumulated 64 KiB before sending anything and
/// flushed a partial buffer only at EOF, which meant Alex's small,
/// long-lived server-sent events sat in the buffer instead of reaching the
/// browser — and the relay's idle-body timer could expire on a stream that
/// was in fact alive.
const MAX_CHUNK_BYTES: usize = 64 * 1024;

/// Headers a public caller must never be able to set.
///
/// `x-forwarded-*` decides the origin middleware builds redirects against,
/// and `x-alex-desktop-auth` is the desktop app's capability token. Both
/// are supplied by us, at this boundary, from values we actually know.
const CALLER_CONTROLLED_HEADERS: &[&str] = &[
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-port",
    "x-forwarded-server",
    "forwarded",
    "x-real-ip",
];

fn is_stripped_request_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    CALLER_CONTROLLED_HEADERS.contains(&lower.as_str())
        // Every internal Alex header, the desktop capability token included.
        || lower.starts_with("x-alex-")
}

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

    // Capture the original Host for X-Forwarded-Host
    let original_host = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("host"))
        .map(|(_, v)| v.clone());

    for (key, value) in &headers {
        // Skip the host header since we're rewriting the target
        if key.eq_ignore_ascii_case("host") {
            continue;
        }
        // Replace caller-supplied forwarding and internal headers with our
        // own values rather than passing them through.
        if is_stripped_request_header(key) {
            continue;
        }
        builder = builder.header(key.as_str(), value.as_str());
    }
    // Set host to local address
    builder = builder.header("host", local_addr);

    // Tell the app the original protocol and host so NextAuth and redirect
    // logic work correctly behind the relay. These are set unconditionally:
    // honouring a value the caller supplied would let a public request
    // choose the origin the app builds redirects against.
    builder = builder.header("x-forwarded-proto", "https");
    if let Some(fwd_host) = &original_host {
        builder = builder.header("x-forwarded-host", fwd_host.as_str());
    }

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

    // Stream the body through as it arrives.
    let mut body = resp.into_body();
    let mut transfer_failed = false;

    while let Some(frame_result) = body.frame().await {
        match frame_result {
            Ok(frame) => {
                if let Some(data) = frame.data_ref() {
                    for slice in data.chunks(MAX_CHUNK_BYTES) {
                        if frame_tx
                            .send(Frame::ResponseChunk {
                                request_id,
                                data: slice.to_vec(),
                            })
                            .await
                            .is_err()
                        {
                            // The connection is gone; nothing left to send.
                            return Ok(());
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("error reading response body for request {request_id}: {e}");
                transfer_failed = true;
                break;
            }
        }
    }

    if transfer_failed {
        // Do not send ResponseEnd: a clean end would present a truncated
        // body as a complete response. Cancel tells the relay to abort the
        // stream so the browser sees a failed transfer.
        frame_tx.send(Frame::Cancel { request_id }).await.ok();
        return Ok(());
    }

    frame_tx.send(Frame::ResponseEnd { request_id }).await.ok();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_stripped_request_header;

    #[test]
    fn strips_caller_supplied_forwarding_headers() {
        for header in [
            "x-forwarded-host",
            "X-Forwarded-Host",
            "x-forwarded-proto",
            "X-Forwarded-Proto",
            "x-forwarded-port",
            "forwarded",
            "x-real-ip",
        ] {
            assert!(is_stripped_request_header(header), "{header} must be stripped");
        }
    }

    #[test]
    fn strips_internal_alex_headers() {
        assert!(is_stripped_request_header("x-alex-desktop-auth"));
        assert!(is_stripped_request_header("X-Alex-Tunnel-Subdomain"));
    }

    #[test]
    fn keeps_ordinary_request_headers() {
        for header in [
            "cookie",
            "accept",
            "accept-encoding",
            "range",
            "content-type",
            "user-agent",
            "if-none-match",
        ] {
            assert!(!is_stripped_request_header(header), "{header} must pass through");
        }
    }
}
