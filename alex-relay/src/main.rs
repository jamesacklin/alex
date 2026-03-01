mod protocol;
mod proxy;
mod relay;

use axum::extract::ConnectInfo;
use axum::extract::State;
use axum::extract::ws::WebSocketUpgrade;
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use clap::Parser;
use relay::RelayState;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::info;

#[derive(Parser)]
#[command(name = "alex-relay", about = "Reverse tunnel relay for Alex")]
struct Cli {
    /// Address to bind the HTTP server.
    #[arg(long, default_value = "0.0.0.0:8080")]
    listen_addr: String,

    /// Base domain for subdomain extraction (e.g., "alexreader.app").
    #[arg(long, default_value = "alexreader.app")]
    domain: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "alex_relay=info".parse().unwrap()),
        )
        .init();

    let cli = Cli::parse();
    let state = Arc::new(RelayState::new(cli.domain));

    let app = Router::new()
        .route("/_tunnel/ws", get(ws_handler))
        .fallback(proxy::proxy_request)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&cli.listen_addr)
        .await
        .expect("failed to bind");

    info!(addr = %cli.listen_addr, "relay listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("server error");
}

async fn ws_handler(
    State(state): State<Arc<RelayState>>,
    ConnectInfo(peer_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Prefer X-Forwarded-For (set by Caddy) over the raw TCP peer address.
    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| peer_addr.ip().to_string());

    ws.on_upgrade(move |socket| relay::handle_tunnel_ws(state, socket, client_ip))
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install ctrl+c handler");
    info!("shutting down");
}
