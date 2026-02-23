pub mod client;
pub mod handlers;
pub mod scanner;
pub mod stream;
pub mod watcher;

/// Configuration for connecting to an S3-compatible bucket.
#[derive(Debug, Clone)]
pub struct S3Config {
    pub endpoint: Option<String>,
    pub region: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub prefix: Option<String>,
    pub poll_interval: u64,
}
