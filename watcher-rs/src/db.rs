use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Database {
    conn: Connection,
}

pub struct BookRow {
    pub id: String,
    pub title: String,
    pub file_hash: String,
    pub file_type: String,
    pub cover_path: Option<String>,
}

pub struct OrphanRow {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub cover_path: Option<String>,
}

/// Row returned when querying S3 books for diff computation.
#[derive(Clone)]
pub struct S3BookRow {
    pub id: String,
    pub title: String,
    pub file_path: String,
    pub file_type: String,
    pub cover_path: Option<String>,
    pub s3_etag: Option<String>,
}

pub struct NewBook<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub author: Option<&'a str>,
    pub description: Option<&'a str>,
    pub file_type: &'a str,
    pub file_path: &'a str,
    pub file_size: i64,
    pub file_hash: &'a str,
    pub cover_path: Option<&'a str>,
    pub page_count: Option<i64>,
    pub added_at: i64,
    pub updated_at: i64,
    pub source: &'a str,
    pub s3_bucket: Option<&'a str>,
    pub s3_etag: Option<&'a str>,
}

pub struct UpdateBook<'a> {
    pub title: &'a str,
    pub author: Option<&'a str>,
    pub description: Option<&'a str>,
    pub file_size: i64,
    pub file_hash: &'a str,
    pub cover_path: Option<&'a str>,
    pub page_count: Option<i64>,
    pub updated_at: i64,
    pub s3_etag: Option<&'a str>,
}

impl Database {
    pub fn open(path: &str) -> Result<Self> {
        let conn =
            Connection::open(path).with_context(|| format!("Failed to open database at {path}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )?;
        Ok(Self { conn })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS books (
                 id TEXT PRIMARY KEY NOT NULL,
                 title TEXT NOT NULL,
                 author TEXT,
                 description TEXT,
                 file_type TEXT NOT NULL,
                 file_path TEXT NOT NULL UNIQUE,
                 file_size INTEGER NOT NULL,
                 file_hash TEXT NOT NULL UNIQUE,
                 cover_path TEXT,
                 page_count INTEGER,
                 added_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 source TEXT NOT NULL DEFAULT 'local',
                 s3_bucket TEXT,
                 s3_etag TEXT
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key TEXT PRIMARY KEY NOT NULL,
                 value TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    pub fn find_by_hash(&self, hash: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT title FROM books WHERE file_hash = ?1 LIMIT 1")?;
        let result = stmt
            .query_row(params![hash], |row| row.get::<_, String>(0))
            .optional()?;
        Ok(result)
    }

    pub fn find_by_path(&self, path: &str) -> Result<Option<BookRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, file_hash, file_type, cover_path
             FROM books WHERE file_path = ?1 LIMIT 1",
        )?;
        let result = stmt
            .query_row(params![path], |row| {
                Ok(BookRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_hash: row.get(2)?,
                    file_type: row.get(3)?,
                    cover_path: row.get(4)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn insert_book(&self, book: &NewBook) -> Result<usize> {
        let changes = self.conn.execute(
            "INSERT INTO books (id, title, author, description, file_type, file_path,
                                file_size, file_hash, cover_path, page_count, added_at, updated_at,
                                source, s3_bucket, s3_etag)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT DO NOTHING",
            params![
                book.id,
                book.title,
                book.author,
                book.description,
                book.file_type,
                book.file_path,
                book.file_size,
                book.file_hash,
                book.cover_path,
                book.page_count,
                book.added_at,
                book.updated_at,
                book.source,
                book.s3_bucket,
                book.s3_etag,
            ],
        )?;
        Ok(changes)
    }

    pub fn update_book(&self, id: &str, book: &UpdateBook) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET title = ?1, author = ?2, description = ?3,
                              file_size = ?4, file_hash = ?5, cover_path = ?6,
                              page_count = ?7, updated_at = ?8, s3_etag = ?9
             WHERE id = ?10",
            params![
                book.title,
                book.author,
                book.description,
                book.file_size,
                book.file_hash,
                book.cover_path,
                book.page_count,
                book.updated_at,
                book.s3_etag,
                id,
            ],
        )?;
        Ok(())
    }

    /// Update only the s3_etag for a book (when content hasn't changed but ETag has).
    pub fn update_s3_etag(&self, id: &str, etag: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET s3_etag = ?1 WHERE id = ?2",
            params![etag, id],
        )?;
        Ok(())
    }

    pub fn delete_book(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM books WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Return all local books (for orphan cleanup in local mode).
    pub fn all_books(&self) -> Result<Vec<OrphanRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, file_path, cover_path FROM books WHERE source = 'local'")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(OrphanRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    cover_path: row.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Return all S3 books for a given bucket (for diff computation).
    pub fn find_s3_books(&self, bucket: &str) -> Result<Vec<S3BookRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, file_path, file_type, cover_path, s3_etag
             FROM books WHERE source = 's3' AND s3_bucket = ?1",
        )?;
        let rows = stmt
            .query_map(params![bucket], |row| {
                Ok(S3BookRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    file_path: row.get(2)?,
                    file_type: row.get(3)?,
                    cover_path: row.get(4)?,
                    s3_etag: row.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_test_schema(&self) {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS books (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    description TEXT,
                    file_type TEXT NOT NULL,
                    file_path TEXT NOT NULL UNIQUE,
                    file_size INTEGER NOT NULL,
                    file_hash TEXT NOT NULL UNIQUE,
                    cover_path TEXT,
                    page_count INTEGER,
                    added_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    source TEXT NOT NULL DEFAULT 'local',
                    s3_bucket TEXT,
                    s3_etag TEXT
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );",
            )
            .expect("Failed to create test schema");
    }

    pub fn get_library_version(&self) -> Result<Option<i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = 'library_version' LIMIT 1")?;
        let result = stmt
            .query_row([], |row| {
                let val: String = row.get(0)?;
                Ok(val.parse::<i64>().unwrap_or(0))
            })
            .optional()?;
        Ok(result)
    }

    pub fn increment_library_version(&self) -> Result<()> {
        let now = unix_now();
        let now_str = now.to_string();
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES ('library_version', ?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![now_str, now],
        )?;
        Ok(())
    }
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs() as i64
}

trait OptionalRow {
    fn optional(self) -> rusqlite::Result<Option<Self::Inner>>
    where
        Self: Sized;
    type Inner;
}

impl<T> OptionalRow for rusqlite::Result<T> {
    type Inner = T;
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}
