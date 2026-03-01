pub mod client;
pub mod protocol;
pub mod proxy;
pub mod wordlist;

use client::TunnelConfig;

/// Run the tunnel client. Blocks until shutdown is signaled.
pub fn run(config: TunnelConfig, shutdown: tokio::sync::watch::Receiver<bool>) {
    let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
    rt.block_on(client::run(config, shutdown));
}
