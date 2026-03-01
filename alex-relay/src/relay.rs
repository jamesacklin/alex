use crate::protocol::Frame;
use axum::extract::ws::{Message, WebSocket};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tracing::{error, info, warn};

/// Collected response data for a single HTTP request.
pub struct ResponseCollector {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body_rx: mpsc::Receiver<ResponseBodyEvent>,
}

pub enum ResponseBodyEvent {
    Chunk(Vec<u8>),
    End,
}

/// Handle for a connected tunnel client.
pub struct ClientHandle {
    /// Send frames to this client's WebSocket writer task.
    pub tx: mpsc::Sender<Frame>,
    /// Pending HTTP requests awaiting responses.
    pub pending: Arc<DashMap<u64, oneshot::Sender<ResponseCollector>>>,
    /// Counter for generating unique request IDs.
    pub next_request_id: Arc<AtomicU64>,
}

/// Global relay state shared across all handlers.
pub struct RelayState {
    /// Maps subdomain → connected client.
    pub clients: DashMap<String, ClientHandle>,
    /// Base domain for subdomain extraction (e.g., "alexreader.app").
    pub domain: String,
}

impl RelayState {
    pub fn new(domain: String) -> Self {
        Self {
            clients: DashMap::new(),
            domain,
        }
    }

    /// Extract subdomain from a Host header value.
    /// E.g., "gentle-morning-tide.alexreader.app" → Some("gentle-morning-tide")
    pub fn extract_subdomain(&self, host: &str) -> Option<String> {
        // Strip port if present
        let host = host.split(':').next().unwrap_or(host);
        let suffix = format!(".{}", self.domain);
        if host.ends_with(&suffix) && host.len() > suffix.len() {
            let subdomain = &host[..host.len() - suffix.len()];
            if !subdomain.is_empty() && !subdomain.contains('.') {
                return Some(subdomain.to_string());
            }
        }
        None
    }
}

/// Handle a new WebSocket connection from a tunnel client.
pub async fn handle_tunnel_ws(state: Arc<RelayState>, ws: WebSocket) {
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Wait for the Register frame
    let subdomain = match ws_rx.next().await {
        Some(Ok(Message::Binary(data))) => match Frame::decode(&data) {
            Ok(Frame::Register { subdomain }) => subdomain,
            Ok(_) => {
                warn!("first frame was not Register");
                return;
            }
            Err(e) => {
                warn!("failed to decode first frame: {e}");
                return;
            }
        },
        _ => {
            warn!("client disconnected before registering");
            return;
        }
    };

    // Check if subdomain is already taken
    if state.clients.contains_key(&subdomain) {
        let ack = Frame::RegisterAck {
            success: false,
            message: "subdomain already in use".to_string(),
        };
        let _ = ws_tx
            .send(Message::Binary(ack.encode().unwrap().into()))
            .await;
        return;
    }

    // Send ack
    let ack = Frame::RegisterAck {
        success: true,
        message: "registered".to_string(),
    };
    if ws_tx
        .send(Message::Binary(ack.encode().unwrap().into()))
        .await
        .is_err()
    {
        return;
    }

    info!(subdomain = %subdomain, "client registered");

    // Set up channels
    let (frame_tx, mut frame_rx) = mpsc::channel::<Frame>(256);
    let pending: Arc<DashMap<u64, oneshot::Sender<ResponseCollector>>> = Arc::new(DashMap::new());
    let next_request_id = Arc::new(AtomicU64::new(1));

    // Store pending map reference for the body channel routing
    // Each pending request, once the initial HttpResponse arrives, gets upgraded to
    // a body_tx channel for streaming chunks.
    let body_channels: Arc<DashMap<u64, mpsc::Sender<ResponseBodyEvent>>> =
        Arc::new(DashMap::new());

    // Register client
    state.clients.insert(
        subdomain.clone(),
        ClientHandle {
            tx: frame_tx,
            pending: pending.clone(),
            next_request_id,
        },
    );

    // Writer task: forward frames from channel to WebSocket
    let writer_task = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            match frame.encode() {
                Ok(data) => {
                    if ws_tx.send(Message::Binary(data.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("failed to encode frame: {e}");
                }
            }
        }
    });

    // Reader task: process incoming frames from client
    let pending_for_reader = pending.clone();
    let body_channels_for_reader = body_channels.clone();
    while let Some(msg) = ws_rx.next().await {
        match msg {
            Ok(Message::Binary(data)) => match Frame::decode(&data) {
                Ok(Frame::HttpResponse {
                    request_id,
                    status,
                    headers,
                }) => {
                    if let Some((_, sender)) = pending_for_reader.remove(&request_id) {
                        let (body_tx, body_rx) = mpsc::channel(64);
                        body_channels_for_reader.insert(request_id, body_tx);
                        let _ = sender.send(ResponseCollector {
                            status,
                            headers,
                            body_rx,
                        });
                    }
                }
                Ok(Frame::ResponseChunk { request_id, data }) => {
                    if let Some(tx) = body_channels_for_reader.get(&request_id) {
                        let _ = tx.send(ResponseBodyEvent::Chunk(data)).await;
                    }
                }
                Ok(Frame::ResponseEnd { request_id }) => {
                    if let Some(tx) = body_channels_for_reader.get(&request_id) {
                        let _ = tx.send(ResponseBodyEvent::End).await;
                    }
                    body_channels_for_reader.remove(&request_id);
                }
                Ok(Frame::Pong) => {}
                Ok(_) => {
                    warn!("unexpected frame from client");
                }
                Err(e) => {
                    warn!("failed to decode frame from client: {e}");
                }
            },
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(e) => {
                warn!("websocket error: {e}");
                break;
            }
        }
    }

    // Clean up
    info!(subdomain = %subdomain, "client disconnected");
    state.clients.remove(&subdomain);
    writer_task.abort();
}
