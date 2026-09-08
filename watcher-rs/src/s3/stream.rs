use anyhow::{Context, Result};
use tokio::io::{AsyncWrite, AsyncWriteExt};

use super::S3Config;
use super::client::create_bucket;

/// Version of the stdout framing described below.
const PROTOCOL_VERSION: u32 = 2;

/// Stream an S3 object to stdout.
///
/// Protocol (v2):
///   1. First line: a JSON header, newline-terminated, describing the
///      response — including `object_size` (the size of the whole object)
///      separately from `content_length` (the bytes that follow).
///   2. Exactly `content_length` bytes of body.
///
/// On failure before any body: a header carrying `error`, and a non-zero
/// exit code. On failure *during* the body: a non-zero exit code, which the
/// reader combines with the byte count to tell a truncated transfer from a
/// complete one.
///
/// This replaces an implementation that buffered the whole object (or range)
/// in memory before writing a byte, and that reported the returned length as
/// the total object length — so a five-byte range of a 1000-byte object was
/// advertised as `bytes 10-14/5` (F07).
pub async fn run(config: S3Config, key: &str, range: Option<&str>) -> Result<()> {
    let bucket = create_bucket(&config)?;
    let mut out = tokio::io::stdout();

    // A HEAD first, so the header can state the true object size and the
    // range can be resolved before any bytes are committed to.
    let (metadata, head_status) = match bucket.head_object(key).await {
        Ok(result) => result,
        Err(error) => {
            write_error(&mut out, 502, &format!("{error:#}")).await?;
            std::process::exit(1);
        }
    };

    if head_status == 404 {
        write_error(&mut out, 404, "object not found").await?;
        std::process::exit(1);
    }
    if !(200..300).contains(&head_status) {
        write_error(
            &mut out,
            502,
            &format!("upstream returned {head_status} for a HEAD request"),
        )
        .await?;
        std::process::exit(1);
    }

    let object_size = metadata.content_length.unwrap_or(0).max(0) as u64;
    let content_type = metadata
        .content_type
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| content_type_for_key(key).to_string());

    let parsed = match range {
        Some(value) => parse_range(value),
        None => None,
    };
    let resolved = resolve_range(parsed, object_size);

    match resolved {
        ResolvedRange::Unsatisfiable => {
            let header = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "status": 416,
                "content_type": content_type,
                "object_size": object_size,
                "content_length": 0,
            });
            write_header(&mut out, &header).await?;
            out.flush().await?;
            return Ok(());
        }
        ResolvedRange::Full { length } => {
            let header = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "status": 200,
                "content_type": content_type,
                "object_size": object_size,
                "content_length": length,
            });
            write_header(&mut out, &header).await?;

            if length == 0 {
                out.flush().await?;
                return Ok(());
            }

            match bucket.get_object_to_writer(key, &mut out).await {
                Ok(status) if (200..300).contains(&status) => {}
                Ok(status) => {
                    eprintln!("upstream returned {status} while streaming s3://{key}");
                    let _ = out.flush().await;
                    std::process::exit(1);
                }
                Err(error) => {
                    eprintln!("failed to stream s3://{key}: {error}");
                    let _ = out.flush().await;
                    std::process::exit(1);
                }
            }
        }
        ResolvedRange::Partial { start, end, length } => {
            let header = serde_json::json!({
                "protocol": PROTOCOL_VERSION,
                "status": 206,
                "content_type": content_type,
                "object_size": object_size,
                "content_length": length,
                "range_start": start,
                "range_end": end,
            });
            write_header(&mut out, &header).await?;

            // `get_object_range_to_writer` asserts start < end, so a
            // single-byte range takes the buffered path — one byte, so the
            // memory is bounded by definition.
            if start == end {
                match bucket.get_object_range(key, start, Some(end)).await {
                    Ok(response) => {
                        out.write_all(&response.to_vec()).await?;
                    }
                    Err(error) => {
                        eprintln!("failed to fetch a single-byte range of s3://{key}: {error}");
                        let _ = out.flush().await;
                        std::process::exit(1);
                    }
                }
            } else {
                match bucket
                    .get_object_range_to_writer(key, start, Some(end), &mut out)
                    .await
                {
                    Ok(status) if (200..300).contains(&status) => {}
                    Ok(status) => {
                        eprintln!("upstream returned {status} while streaming a range of s3://{key}");
                        let _ = out.flush().await;
                        std::process::exit(1);
                    }
                    Err(error) => {
                        eprintln!("failed to stream a range of s3://{key}: {error}");
                        let _ = out.flush().await;
                        std::process::exit(1);
                    }
                }
            }
        }
    }

    out.flush().await?;
    Ok(())
}

async fn write_header<W: AsyncWrite + Unpin>(out: &mut W, header: &serde_json::Value) -> Result<()> {
    let mut line = serde_json::to_vec(header).context("failed to serialize the stream header")?;
    line.push(b'\n');
    out.write_all(&line).await?;
    // Flush so the reader can build its response before any body arrives.
    out.flush().await?;
    Ok(())
}

async fn write_error<W: AsyncWrite + Unpin>(out: &mut W, status: u16, message: &str) -> Result<()> {
    let header = serde_json::json!({
        "protocol": PROTOCOL_VERSION,
        "status": status,
        "error": message,
        "content_length": 0,
    });
    write_header(out, &header).await
}

fn content_type_for_key(key: &str) -> &'static str {
    if key.to_lowercase().ends_with(".epub") {
        "application/epub+zip"
    } else {
        "application/pdf"
    }
}

/// A `Range` header value, before it is resolved against a size.
#[derive(Debug, PartialEq, Eq)]
pub enum ParsedRange {
    Closed { start: u64, end: u64 },
    From { start: u64 },
    Suffix { length: u64 },
}

/// A range resolved against a known object size.
#[derive(Debug, PartialEq, Eq)]
pub enum ResolvedRange {
    Full { length: u64 },
    Partial { start: u64, end: u64, length: u64 },
    Unsatisfiable,
}

/// Parse a single-range `Range` header value.
///
/// Returns `None` for an absent, malformed or multi-range header, which per
/// RFC 9110 §14.2 means "ignore it and send the whole representation".
/// Mirrors `src/lib/files/range.ts` so the local and S3 drivers agree.
pub fn parse_range(range: &str) -> Option<ParsedRange> {
    let value = range.trim().strip_prefix("bytes=")?;

    // A comma means multiple ranges, which this implementation does not serve.
    if value.contains(',') {
        return None;
    }

    let (raw_start, raw_end) = value.split_once('-')?;

    if raw_start.is_empty() && raw_end.is_empty() {
        return None;
    }

    if raw_start.is_empty() {
        let length = raw_end.parse::<u64>().ok()?;
        return Some(ParsedRange::Suffix { length });
    }

    let start = raw_start.parse::<u64>().ok()?;

    if raw_end.is_empty() {
        return Some(ParsedRange::From { start });
    }

    let end = raw_end.parse::<u64>().ok()?;
    Some(ParsedRange::Closed { start, end })
}

/// Resolve a parsed range against a known object size.
pub fn resolve_range(range: Option<ParsedRange>, size: u64) -> ResolvedRange {
    let Some(range) = range else {
        return ResolvedRange::Full { length: size };
    };

    if size == 0 {
        return ResolvedRange::Unsatisfiable;
    }

    match range {
        ParsedRange::Suffix { length } => {
            if length == 0 {
                return ResolvedRange::Unsatisfiable;
            }
            let start = size.saturating_sub(length);
            ResolvedRange::Partial {
                start,
                end: size - 1,
                length: size - start,
            }
        }
        ParsedRange::From { start } => {
            if start >= size {
                return ResolvedRange::Unsatisfiable;
            }
            ResolvedRange::Partial {
                start,
                end: size - 1,
                length: size - start,
            }
        }
        ParsedRange::Closed { start, end } => {
            if start >= size || end < start {
                return ResolvedRange::Unsatisfiable;
            }
            // Clamp rather than reject an end past the last byte.
            let end = end.min(size - 1);
            ResolvedRange::Partial {
                start,
                end,
                length: end - start + 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ParsedRange, ResolvedRange, parse_range, resolve_range};

    #[test]
    fn parse_range_handles_start_and_end() {
        assert_eq!(
            parse_range("bytes=10-20"),
            Some(ParsedRange::Closed { start: 10, end: 20 })
        );
    }

    #[test]
    fn parse_range_handles_open_ended_range() {
        assert_eq!(
            parse_range("bytes=512-"),
            Some(ParsedRange::From { start: 512 })
        );
    }

    /// The previous parser read `bytes=-1024` as "start at 0, end at 1024".
    /// A suffix range asks for the *last* 1024 bytes.
    #[test]
    fn parse_range_reads_a_suffix_range_as_a_suffix() {
        assert_eq!(
            parse_range("bytes=-1024"),
            Some(ParsedRange::Suffix { length: 1024 })
        );
    }

    #[test]
    fn parse_range_ignores_malformed_headers() {
        for value in [
            "10-20",
            "bytes=100",
            "bytes=a-10",
            "bytes=10-z",
            "bytes=-",
            "bytes=0-1,2-3",
            "",
        ] {
            assert_eq!(parse_range(value), None, "{value} should be ignored");
        }
    }

    #[test]
    fn resolves_a_missing_range_to_the_whole_object() {
        assert_eq!(
            resolve_range(None, 1000),
            ResolvedRange::Full { length: 1000 }
        );
    }

    #[test]
    fn resolves_a_closed_range() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 10, end: 14 }), 1000),
            ResolvedRange::Partial {
                start: 10,
                end: 14,
                length: 5
            }
        );
    }

    #[test]
    fn clamps_an_end_past_the_last_byte() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 990, end: 5000 }), 1000),
            ResolvedRange::Partial {
                start: 990,
                end: 999,
                length: 10
            }
        );
    }

    #[test]
    fn resolves_an_open_ended_range() {
        assert_eq!(
            resolve_range(Some(ParsedRange::From { start: 998 }), 1000),
            ResolvedRange::Partial {
                start: 998,
                end: 999,
                length: 2
            }
        );
    }

    #[test]
    fn resolves_a_suffix_range_from_the_end() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Suffix { length: 10 }), 1000),
            ResolvedRange::Partial {
                start: 990,
                end: 999,
                length: 10
            }
        );
    }

    #[test]
    fn clamps_a_suffix_longer_than_the_object() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Suffix { length: 5000 }), 1000),
            ResolvedRange::Partial {
                start: 0,
                end: 999,
                length: 1000
            }
        );
    }

    #[test]
    fn rejects_a_start_past_the_end() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 1000, end: 1010 }), 1000),
            ResolvedRange::Unsatisfiable
        );
        assert_eq!(
            resolve_range(Some(ParsedRange::From { start: 1000 }), 1000),
            ResolvedRange::Unsatisfiable
        );
    }

    #[test]
    fn rejects_an_inverted_range() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 50, end: 10 }), 1000),
            ResolvedRange::Unsatisfiable
        );
    }

    #[test]
    fn rejects_a_zero_length_suffix() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Suffix { length: 0 }), 1000),
            ResolvedRange::Unsatisfiable
        );
    }

    /// An empty object has no satisfiable range; the previous local driver
    /// could ask for a stream ending at byte -1 here.
    #[test]
    fn rejects_every_range_against_an_empty_object() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 0, end: 0 }), 0),
            ResolvedRange::Unsatisfiable
        );
        assert_eq!(
            resolve_range(Some(ParsedRange::From { start: 0 }), 0),
            ResolvedRange::Unsatisfiable
        );
        assert_eq!(
            resolve_range(Some(ParsedRange::Suffix { length: 10 }), 0),
            ResolvedRange::Unsatisfiable
        );
        assert_eq!(resolve_range(None, 0), ResolvedRange::Full { length: 0 });
    }

    #[test]
    fn resolves_a_single_byte_range() {
        assert_eq!(
            resolve_range(Some(ParsedRange::Closed { start: 5, end: 5 }), 1000),
            ResolvedRange::Partial {
                start: 5,
                end: 5,
                length: 1
            }
        );
    }
}
