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

#[cfg(test)]
mod tests {
    use super::{S3Object, compute_diff, title_from_key};
    use crate::db::S3BookRow;

    fn s3_book_row(path: &str, etag: Option<&str>) -> S3BookRow {
        S3BookRow {
            id: format!("id-{path}"),
            title: format!("title-{path}"),
            file_path: path.to_string(),
            file_type: if path.to_lowercase().ends_with(".epub") {
                "epub".to_string()
            } else {
                "pdf".to_string()
            },
            cover_path: None,
            s3_etag: etag.map(|value| value.to_string()),
        }
    }

    fn s3_object(path: &str, etag: &str) -> S3Object {
        S3Object {
            key: path.to_string(),
            size: 123,
            etag: etag.to_string(),
        }
    }

    #[test]
    fn compute_diff_identifies_added_changed_removed() {
        let s3_objects = vec![
            s3_object("new-book.pdf", "etag-new"),
            s3_object("changed-book.epub", "etag-2"),
            s3_object("same-book.pdf", "etag-same"),
        ];
        let db_books = vec![
            s3_book_row("changed-book.epub", Some("etag-1")),
            s3_book_row("same-book.pdf", Some("etag-same")),
            s3_book_row("removed-book.pdf", Some("etag-removed")),
        ];

        let diff = compute_diff(&s3_objects, &db_books);

        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.changed.len(), 1);
        assert_eq!(diff.removed.len(), 1);

        assert_eq!(diff.added[0].key, "new-book.pdf");
        assert_eq!(diff.changed[0].key, "changed-book.epub");
        assert_eq!(diff.removed[0].file_path, "removed-book.pdf");
    }

    #[test]
    fn compute_diff_treats_missing_db_etag_as_changed() {
        let s3_objects = vec![s3_object("book.pdf", "etag-1")];
        let db_books = vec![s3_book_row("book.pdf", None)];

        let diff = compute_diff(&s3_objects, &db_books);

        assert!(diff.added.is_empty());
        assert_eq!(diff.changed.len(), 1);
        assert!(diff.removed.is_empty());
        assert_eq!(diff.changed[0].key, "book.pdf");
    }

    #[test]
    fn compute_diff_empty_inputs_are_stable() {
        let diff = compute_diff(&[], &[]);
        assert!(diff.added.is_empty());
        assert!(diff.changed.is_empty());
        assert!(diff.removed.is_empty());
    }

    #[test]
    fn title_from_key_uses_filename_without_extension() {
        assert_eq!(
            title_from_key("books/My Great Book.pdf"),
            "My Great Book".to_string()
        );
        assert_eq!(title_from_key("plain.epub"), "plain".to_string());
        assert_eq!(
            title_from_key("nested/path/with.dots.v1.epub"),
            "with.dots.v1".to_string()
        );
    }

    #[test]
    fn title_from_key_returns_filename_when_no_extension() {
        assert_eq!(title_from_key("books/README"), "README".to_string());
        assert_eq!(title_from_key("just-a-key"), "just-a-key".to_string());
    }
}
