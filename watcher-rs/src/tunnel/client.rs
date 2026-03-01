use crate::tunnel::protocol::Frame;
use crate::tunnel::proxy;
use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const INITIAL_BACKOFF_SECS: u64 = 5;
const MAX_BACKOFF_SECS: u64 = 60;

pub struct TunnelConfig {
    pub subdomain: String,
    pub relay_url: String,
    pub local_addr: String,
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
    let (ws_stream, _) = tokio_tungstenite::connect_async(&config.relay_url)
        .await
        .context("failed to connect to relay")?;

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Send Register frame
    let register = Frame::Register {
        subdomain: config.subdomain.clone(),
    };
    ws_tx
        .send(Message::Binary(register.encode()?.into()))
        .await
        .context("failed to send register")?;

    // Wait for RegisterAck
    match ws_rx.next().await {
        Some(Ok(Message::Binary(data))) => match Frame::decode(&data) {
            Ok(Frame::RegisterAck { success, message }) => {
                if !success {
                    anyhow::bail!("registration rejected: {message}");
                }
                eprintln!("registered as {}", config.subdomain);
            }
            Ok(_) => anyhow::bail!("unexpected frame instead of RegisterAck"),
            Err(e) => anyhow::bail!("failed to decode RegisterAck: {e}"),
        },
        Some(Ok(_)) => anyhow::bail!("unexpected message type for RegisterAck"),
        Some(Err(e)) => anyhow::bail!("websocket error waiting for RegisterAck: {e}"),
        None => anyhow::bail!("connection closed before RegisterAck"),
    }

    // Reset backoff on successful connection (caller handles this implicitly
    // since a new backoff starts fresh in the loop on success)

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

    // Reader loop: process incoming frames from relay
    let local_addr = config.local_addr.clone();
    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        match Frame::decode(&data) {
                            Ok(Frame::HttpRequest { request_id, method, uri, headers, body }) => {
                                let tx = frame_tx.clone();
                                let addr = local_addr.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = proxy::forward_request(
                                        &tx, request_id, method, uri, headers, body, &addr,
                                    ).await {
                                        eprintln!("error forwarding request {request_id}: {e}");
                                    }
                                });
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
                        anyhow::bail!("relay closed connection");
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        anyhow::bail!("websocket error: {e}");
                    }
                    None => {
                        anyhow::bail!("connection closed");
                    }
                }
            }
            _ = shutdown.changed() => {
                writer_task.abort();
                return Ok(());
            }
        }
    }
}
