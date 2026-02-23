use anyhow::{Context, Result};
use std::io::Write;

use super::S3Config;
use super::client::create_bucket;

/// Stream an S3 object to stdout.
///
/// Protocol:
///   1. First line: JSON header `{"content_length": N, "content_type": "..."}\n`
///   2. Remaining bytes: raw object body
///
/// If `range` is provided (e.g. "bytes=0-1023"), a range request is made.
pub async fn run(config: S3Config, key: &str, range: Option<&str>) -> Result<()> {
    let bucket = create_bucket(&config)?;
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    let content_type = if key.to_lowercase().ends_with(".epub") {
        "application/epub+zip"
    } else {
        "application/pdf"
    };

    if let Some(range_value) = range {
        // Parse "bytes=START-END"
        let (start, end) = parse_range(range_value)?;
        let response = bucket
            .get_object_range(key, start, end)
            .await
            .with_context(|| format!("Failed to get range from s3://{}", key))?;

        let bytes = response.to_vec();
        let header = serde_json::json!({
            "content_length": bytes.len(),
            "content_type": content_type,
            "status": 206,
            "range_start": start,
            "range_end": start + bytes.len() as u64 - 1,
        });
        writeln!(out, "{}", header)?;
        out.write_all(&bytes)?;
    } else {
        let response = bucket
            .get_object(key)
            .await
            .with_context(|| format!("Failed to get s3://{}", key))?;

        let bytes = response.to_vec();
        let header = serde_json::json!({
            "content_length": bytes.len(),
            "content_type": content_type,
            "status": 200,
        });
        writeln!(out, "{}", header)?;
        out.write_all(&bytes)?;
    }

    out.flush()?;
    Ok(())
}

/// Parse a Range header value like "bytes=0-1023" into (start, Option<end>).
fn parse_range(range: &str) -> Result<(u64, Option<u64>)> {
    let range = range
        .strip_prefix("bytes=")
        .context("Invalid range header: must start with 'bytes='")?;

    let parts: Vec<&str> = range.splitn(2, '-').collect();
    if parts.len() != 2 {
        anyhow::bail!("Invalid range format: {}", range);
    }

    let start = if parts[0].is_empty() {
        0
    } else {
        parts[0].parse::<u64>().context("Invalid range start")?
    };

    let end = if parts[1].is_empty() {
        None
    } else {
        Some(parts[1].parse::<u64>().context("Invalid range end")?)
    };

    Ok((start, end))
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn parse_range_handles_start_and_end() {
        let (start, end) = parse_range("bytes=10-20").expect("range should parse");
        assert_eq!(start, 10);
        assert_eq!(end, Some(20));
    }

    #[test]
    fn parse_range_handles_open_ended_range() {
        let (start, end) = parse_range("bytes=512-").expect("range should parse");
        assert_eq!(start, 512);
        assert_eq!(end, None);
    }

    #[test]
    fn parse_range_handles_missing_start_as_zero() {
        let (start, end) = parse_range("bytes=-1024").expect("range should parse");
        assert_eq!(start, 0);
        assert_eq!(end, Some(1024));
    }

    #[test]
    fn parse_range_rejects_missing_prefix() {
        let error = parse_range("10-20").expect_err("missing bytes= must fail");
        assert!(
            error
                .to_string()
                .contains("Invalid range header: must start with 'bytes='")
        );
    }

    #[test]
    fn parse_range_rejects_non_numeric_start() {
        let error = parse_range("bytes=a-10").expect_err("non numeric start must fail");
        assert!(error.to_string().contains("Invalid range start"));
    }

    #[test]
    fn parse_range_rejects_non_numeric_end() {
        let error = parse_range("bytes=10-z").expect_err("non numeric end must fail");
        assert!(error.to_string().contains("Invalid range end"));
    }

    #[test]
    fn parse_range_rejects_missing_separator() {
        let error = parse_range("bytes=100").expect_err("missing separator must fail");
        assert!(error.to_string().contains("Invalid range format"));
    }
}
