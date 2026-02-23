use super::S3Config;
use anyhow::{Context, Result};
use s3::creds::Credentials;
use s3::region::Region;
use s3::Bucket;

/// Create an S3 Bucket handle from config.
pub fn create_bucket(config: &S3Config) -> Result<Box<Bucket>> {
    let region = if let Some(ref endpoint) = config.endpoint {
        Region::Custom {
            region: config.region.clone(),
            endpoint: endpoint.clone(),
        }
    } else {
        config.region.parse().context("Invalid S3 region")?
    };

    let credentials = Credentials::new(
        Some(&config.access_key),
        Some(&config.secret_key),
        None,
        None,
        None,
    )
    .context("Failed to create S3 credentials")?;

    let bucket = Bucket::new(&config.bucket, region, credentials)
        .context("Failed to create S3 bucket handle")?
        .with_path_style();

    Ok(bucket)
}
