use crate::tunnel::auth;
use crate::tunnel::protocol::{Frame, PROTOCOL_VERSION};
use crate::tunnel::proxy;
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Semaphore, mpsc};
use tokio::task::AbortHandle;
use tokio_tungstenite::tungstenite::Message;

const INITIAL_BACKOFF_SECS: u64 = 5;
const MAX_BACKOFF_SECS: u64 = 60;

/// How long to wait for the relay's challenge before giving up.
///
/// A protocol v1 relay never sends one, so this is also what turns a
/// version mismatch into a clear error instead of a silent hang.
const CHALLENGE_TIMEOUT_SECS: u64 = 15;

/// Ceiling on requests being forwarded to the local server at once.
///
/// Each inbound request used to spawn an unbounded task, so a burst of
/// public traffic could spawn tasks and open local connections without
/// limit.
const MAX_CONCURRENT_REQUESTS: usize = 32;

pub struct TunnelConfig {
    pub subdomain: String,
    pub relay_url: String,
    pub local_addr: String,
    /// 32-byte ownership secret for `subdomain`, base64.
    ///
    /// Empty means "this name has no proof yet": the client will claim the
    /// name if the relay reports it as unclaimed, and fail with an
    /// actionable error if the relay says somebody already owns it.
    pub secret_base64: String,
}

impl TunnelConfig {
    fn secret(&self) -> Result<Vec<u8>> {
        if self.secret_base64.is_empty() {
            return Ok(Vec::new());
        }
        decode_base64(&self.secret_base64).context("tunnel secret is not valid base64")
    }
}

/// Run the tunnel client with automatic reconnection.
/// Returns when the shutdown signal is received.
pub async fn run(config: TunnelConfig, mut shutdown: tokio::sync::watch::Receiver<bool>) {
    let config = Arc::new(config);
    let mut backoff_secs = INITIAL_BACKOFF_SECS;

    loop {
        eprintln!(
            "connecting to relay at {} (subdomain: {})",
            config.relay_url, config.subdomain
        );

        match connect_and_serve(&config, &mut shutdown).await {
            Ok(()) => {
                // Clean shutdown requested
                eprintln!("tunnel shutting down");
                return;
            }
            Err(e) => {
                eprintln!("tunnel connection error: {e}");
                eprintln!("reconnecting in {backoff_secs}s...");

                tokio::select! {
                    _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {}
                    _ = shutdown.changed() => {
                        eprintln!("tunnel shutting down during backoff");
                        return;
                    }
                }

                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
            }
        }
    }
}

async fn connect_and_serve(
    config: &Arc<TunnelConfig>,
    shutdown: &mut tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    // Cloudflare routes the upgrade to the Durable Object for this subdomain
    // before it can inspect our first binary frame.
    let mut relay_url = url::Url::parse(&config.relay_url).context("invalid relay URL")?;
    relay_url
        .query_pairs_mut()
        .append_pair("subdomain", &config.subdomain);

    let (ws_stream, _) = tokio_tungstenite::connect_async(relay_url.as_str())
        .await
        .context("failed to connect to relay")?;

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // --- Authenticated registration -------------------------------------
    let challenge = tokio::time::timeout(
        std::time::Duration::from_secs(CHALLENGE_TIMEOUT_SECS),
        next_frame(&mut ws_rx),
    )
    .await
    .map_err(|_| {
        anyhow::anyhow!(
            "relay did not send a registration challenge within {CHALLENGE_TIMEOUT_SECS}s; \
             it may be running an older protocol than this client (v{PROTOCOL_VERSION})"
        )
    })??;

    let (nonce, claimed) = match challenge {
        Frame::Challenge {
            protocol_version,
            nonce,
            claimed,
        } => {
            if protocol_version != PROTOCOL_VERSION {
                anyhow::bail!(
                    "relay speaks tunnel protocol v{protocol_version}, this client speaks \
                     v{PROTOCOL_VERSION}; upgrade the relay or the app"
                );
            }
            (nonce, claimed)
        }
        Frame::RegisterAck { message, .. } => {
            anyhow::bail!("relay rejected the connection: {message}")
        }
        other => anyhow::bail!("expected a Challenge frame, got {other:?}"),
    };

    let secret = config.secret()?;
    let registration = if claimed {
        if secret.is_empty() {
            anyhow::bail!(
                "the relay already has an owner for \"{}\" but this installation holds no \
                 ownership secret. Generate a new public URL in Admin -> Users to claim a \
                 fresh name.",
                config.subdomain
            );
        }
        Frame::Prove {
            protocol_version: PROTOCOL_VERSION,
            subdomain: config.subdomain.clone(),
            proof: auth::compute_proof(&secret, &nonce, &config.subdomain),
        }
    } else {
        if secret.is_empty() {
            anyhow::bail!(
                "no ownership secret is configured for \"{}\"; refusing to register an \
                 unauthenticated name",
                config.subdomain
            );
        }
        Frame::Claim {
            protocol_version: PROTOCOL_VERSION,
            subdomain: config.subdomain.clone(),
            secret: secret.clone(),
        }
    };

    ws_tx
        .send(Message::Binary(registration.encode()?.into()))
        .await
        .context("failed to send tunnel registration")?;

    match next_frame(&mut ws_rx).await? {
        Frame::RegisterAck { success, message } => {
            if !success {
                anyhow::bail!("registration rejected: {message}");
            }
            eprintln!(
                "registered as {} ({})",
                config.subdomain,
                if claimed { "ownership proven" } else { "name claimed" }
            );
        }
        other => anyhow::bail!("expected RegisterAck, got {other:?}"),
    }

    // --- Request forwarding ---------------------------------------------

    // Channel for sending frames back to relay
    let (frame_tx, mut frame_rx) = mpsc::channel::<Frame>(256);

    // Writer task: forward outgoing frames to WebSocket
    let writer_task = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            match frame.encode() {
                Ok(data) => {
                    if ws_tx.send(Message::Binary(data.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("failed to encode frame: {e}");
                }
            }
        }
    });

    // Bound the number of local requests in flight, and keep a handle to
    // each so a Cancel frame (or losing the connection) can stop the work
    // instead of leaving it running against the local server.
    let permits = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));
    let mut in_flight: HashMap<u64, AbortHandle> = HashMap::new();

    let local_addr = config.local_addr.clone();
    let result = loop {
        // Drop handles for requests that have finished.
        in_flight.retain(|_, handle| !handle.is_finished());

        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        match Frame::decode(&data) {
                            Ok(Frame::HttpRequest { request_id, method, uri, headers, body }) => {
                                let tx = frame_tx.clone();
                                let addr = local_addr.clone();
                                let permits = Arc::clone(&permits);
                                let task = tokio::spawn(async move {
                                    // Applying backpressure here rather than
                                    // refusing the request keeps the relay's
                                    // own queue as the pressure point.
                                    let _permit = match permits.acquire().await {
                                        Ok(permit) => permit,
                                        Err(_) => return,
                                    };
                                    if let Err(e) = proxy::forward_request(
                                        &tx, request_id, method, uri, headers, body, &addr,
                                    ).await {
                                        eprintln!("error forwarding request {request_id}: {e}");
                                        let _ = tx.send(Frame::Cancel { request_id }).await;
                                    }
                                });
                                in_flight.insert(request_id, task.abort_handle());
                            }
                            Ok(Frame::Cancel { request_id }) => {
                                if let Some(handle) = in_flight.remove(&request_id) {
                                    handle.abort();
                                }
                            }
                            Ok(Frame::Ping) => {
                                let _ = frame_tx.send(Frame::Pong).await;
                            }
                            Ok(_) => {}
                            Err(e) => {
                                eprintln!("failed to decode frame: {e}");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        break Err(anyhow::anyhow!("relay closed connection"));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        break Err(anyhow::anyhow!("websocket error: {e}"));
                    }
                    None => {
                        break Err(anyhow::anyhow!("connection closed"));
                    }
                }
            }
            _ = shutdown.changed() => {
                break Ok(());
            }
        }
    };

    // Losing the connection (or shutting down) must not leave requests
    // running: their responses have nowhere to go.
    for (_, handle) in in_flight.drain() {
        handle.abort();
    }
    writer_task.abort();

    result
}

async fn next_frame<S>(stream: &mut S) -> Result<Frame>
where
    S: futures_util::Stream<
            Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>,
        > + Unpin,
{
    match stream.next().await {
        Some(Ok(Message::Binary(data))) => {
            Frame::decode(&data).map_err(|e| anyhow::anyhow!("failed to decode frame: {e}"))
        }
        Some(Ok(Message::Close(_))) => anyhow::bail!("relay closed the connection"),
        Some(Ok(other)) => anyhow::bail!("unexpected websocket message: {other:?}"),
        Some(Err(e)) => anyhow::bail!("websocket error: {e}"),
        None => anyhow::bail!("connection closed before a frame arrived"),
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut lookup = [0xffu8; 256];
    for (index, byte) in TABLE.iter().enumerate() {
        lookup[*byte as usize] = index as u8;
    }

    let trimmed: Vec<u8> = input
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace() && *byte != b'=')
        .collect();

    let mut output = Vec::with_capacity(trimmed.len() * 3 / 4);
    let mut accumulator: u32 = 0;
    let mut bits = 0u32;

    for byte in trimmed {
        let value = lookup[byte as usize];
        if value == 0xff {
            anyhow::bail!("invalid base64 character");
        }
        accumulator = (accumulator << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((accumulator >> bits) & 0xff) as u8);
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::decode_base64;

    #[test]
    fn decodes_padded_and_unpadded_base64() {
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode_base64("QQ==").unwrap(), b"A".to_vec());
        assert_eq!(decode_base64("QUI=").unwrap(), b"AB".to_vec());
        assert_eq!(decode_base64("QUJD").unwrap(), b"ABC".to_vec());
        assert_eq!(decode_base64("QUJDRA==").unwrap(), b"ABCD".to_vec());
    }

    #[test]
    fn decodes_a_32_byte_secret() {
        let secret: Vec<u8> = (0u8..32).collect();
        let encoded = encode_base64(&secret);
        assert_eq!(decode_base64(&encoded).unwrap(), secret);
    }

    #[test]
    fn rejects_invalid_characters() {
        assert!(decode_base64("!!!!").is_err());
    }

    fn encode_base64(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let triple = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
            out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
            out.push(if chunk.len() > 1 {
                TABLE[((triple >> 6) & 0x3f) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                TABLE[(triple & 0x3f) as usize] as char
            } else {
                '='
            });
        }
        out
    }
}
