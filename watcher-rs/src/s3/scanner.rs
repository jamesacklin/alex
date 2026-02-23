use anyhow::{Context, Result};
use s3::Bucket;
use std::collections::HashMap;

use crate::db::S3BookRow;

/// An object found in S3 during a scan.
#[derive(Debug, Clone)]
pub struct S3Object {
    pub key: String,
    pub size: u64,
    pub etag: String,
}

/// The diff between what's in S3 and what's in the database.
pub struct ScanDiff {
    pub added: Vec<S3Object>,
    pub changed: Vec<S3Object>,
    pub removed: Vec<S3BookRow>,
}

/// List all .pdf and .epub objects in the bucket under the given prefix.
pub async fn list_objects(bucket: &Bucket, prefix: Option<&str>) -> Result<Vec<S3Object>> {
    let results = bucket
        .list(prefix.unwrap_or_default().to_string(), None)
        .await
        .context("Failed to list S3 objects")?;

    let mut objects = Vec::new();
    for result in &results {
        for item in &result.contents {
            let key_lower = item.key.to_lowercase();
            if key_lower.ends_with(".pdf") || key_lower.ends_with(".epub") {
                objects.push(S3Object {
                    key: item.key.clone(),
                    size: item.size,
                    etag: item.e_tag.clone().unwrap_or_default(),
                });
            }
        }
    }

    Ok(objects)
}

/// Compare S3 listing against DB records to find what changed.
pub fn compute_diff(s3_objects: &[S3Object], db_books: &[S3BookRow]) -> ScanDiff {
    let s3_map: HashMap<&str, &S3Object> = s3_objects.iter().map(|o| (o.key.as_str(), o)).collect();
    let db_map: HashMap<&str, &S3BookRow> =
        db_books.iter().map(|b| (b.file_path.as_str(), b)).collect();

    let added: Vec<S3Object> = s3_objects
        .iter()
        .filter(|o| !db_map.contains_key(o.key.as_str()))
        .cloned()
        .collect();

    let changed: Vec<S3Object> = s3_objects
        .iter()
        .filter(|o| {
            db_map
                .get(o.key.as_str())
                .map_or(false, |b| b.s3_etag.as_deref() != Some(&o.etag))
        })
        .cloned()
        .collect();

    let removed: Vec<S3BookRow> = db_books
        .iter()
        .filter(|b| !s3_map.contains_key(b.file_path.as_str()))
        .cloned()
        .collect();

    ScanDiff {
        added,
        changed,
        removed,
    }
}

/// Derive a human-readable title from an S3 object key.
/// e.g. "books/My Great Book.pdf" → "My Great Book"
pub fn title_from_key(key: &str) -> String {
    let filename = key.rsplit('/').next().unwrap_or(key);
    filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename)
        .to_string()
}
