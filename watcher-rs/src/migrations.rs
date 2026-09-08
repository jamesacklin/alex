//! Versioned schema migrations.
//!
//! This is the single canonical migration implementation.  `pnpm db:push`,
//! the Electron main process and the Docker entrypoint all reach it through
//! `watcher-rs db migrate`, so there is exactly one ordering of statements
//! and one record of what has been applied.
//!
//! The SQL is embedded in the binary with `include_str!` so a packaged
//! desktop app or a slim container image cannot end up "running" with the
//! migration files missing.
//!
//! Each migration is applied inside its own transaction together with the
//! `schema_migrations` row that records it, so a failure leaves no partial
//! state and no false "applied" marker.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};

const MIGRATION_BREAKPOINT: &str = "--> statement-breakpoint";

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 0,
        name: "wide_expediter",
        sql: include_str!("../../src/lib/db/migrations/0000_wide_expediter.sql"),
    },
    Migration {
        version: 1,
        name: "s3_source_columns",
        sql: include_str!("../../src/lib/db/migrations/0001_s3_source_columns.sql"),
    },
    Migration {
        version: 2,
        name: "book_unique_indexes",
        sql: include_str!("../../src/lib/db/migrations/0002_book_unique_indexes.sql"),
    },
    Migration {
        version: 3,
        name: "session_revocation",
        sql: include_str!("../../src/lib/db/migrations/0003_session_revocation.sql"),
    },
    Migration {
        version: 4,
        name: "progress_unique",
        sql: include_str!("../../src/lib/db/migrations/0004_progress_unique.sql"),
    },
];

#[derive(Debug, PartialEq, Eq)]
pub struct AppliedMigration {
    pub version: i64,
    pub name: &'static str,
}

/// Apply every migration the database has not recorded yet.
///
/// Returns the migrations applied by this call, in order.
pub fn run(conn: &mut Connection) -> Result<Vec<AppliedMigration>> {
    ensure_ledger(conn)?;
    backfill_legacy_baseline(conn)?;

    let mut applied = Vec::new();
    for migration in MIGRATIONS {
        if is_applied(conn, migration.version)? {
            continue;
        }
        apply(conn, migration)?;
        applied.push(AppliedMigration {
            version: migration.version,
            name: migration.name,
        });
    }

    Ok(applied)
}

/// Highest recorded migration version, or `None` on an unmigrated database.
pub fn current_version(conn: &Connection) -> Result<Option<i64>> {
    if !table_exists(conn, "schema_migrations")? {
        return Ok(None);
    }
    let version: Option<i64> = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .optional()?
        .flatten();
    Ok(version)
}

fn ensure_ledger(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version INTEGER PRIMARY KEY NOT NULL,
             name TEXT NOT NULL,
             applied_at INTEGER NOT NULL
         );",
    )
    .context("Failed to create schema_migrations table")?;
    Ok(())
}

/// Record migrations that a pre-runner database already satisfies.
///
/// Databases created before this runner existed have no ledger.  Replaying
/// 0000 against them would fail, and replaying 0004's dedupe is wasted work,
/// so infer what is already present from the schema itself and record it.
/// Nothing is inferred for a fresh (tableless) database — it simply runs
/// every migration from the start.
fn backfill_legacy_baseline(conn: &mut Connection) -> Result<()> {
    let ledger_empty: i64 =
        conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    if ledger_empty > 0 {
        return Ok(());
    }

    if !table_exists(conn, "users")? {
        // Fresh database: let the migrations run from 0000.
        return Ok(());
    }

    let mut baseline = vec![0i64];
    if column_exists(conn, "books", "source")? {
        baseline.push(1);
    }
    if index_exists(conn, "books_file_hash_unique")?
        && index_exists(conn, "books_file_path_unique")?
    {
        baseline.push(2);
    }
    if column_exists(conn, "users", "session_version")? {
        baseline.push(3);
    }
    if index_exists(conn, "reading_progress_user_book_unique")? {
        baseline.push(4);
    }

    let tx = conn.transaction()?;
    for version in baseline {
        let name = MIGRATIONS
            .iter()
            .find(|m| m.version == version)
            .map(|m| m.name)
            .unwrap_or("unknown");
        tx.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, ?3)",
            params![version, name, crate::db::unix_now()],
        )?;
    }
    tx.commit()?;

    Ok(())
}

fn apply(conn: &mut Connection, migration: &Migration) -> Result<()> {
    let statements = split_statements(migration.sql);
    let tx = conn
        .transaction()
        .with_context(|| format!("Failed to begin migration {}", migration.version))?;

    for statement in &statements {
        tx.execute_batch(statement).with_context(|| {
            format!(
                "Migration {} ({}) failed on statement: {}",
                migration.version, migration.name, statement
            )
        })?;
    }

    tx.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        params![migration.version, migration.name, crate::db::unix_now()],
    )?;

    tx.commit()
        .with_context(|| format!("Failed to commit migration {}", migration.version))?;

    Ok(())
}

fn is_applied(conn: &Connection, version: i64) -> Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = ?1",
            params![version],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn split_statements(sql: &str) -> Vec<String> {
    sql.split(MIGRATION_BREAKPOINT)
        .map(|statement| statement.trim().to_string())
        .filter(|statement| !statement.is_empty())
        .collect()
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            params![name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn index_exists(conn: &Connection, name: &str) -> Result<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1 LIMIT 1",
            params![name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    if !table_exists(conn, table)? {
        return Ok(false);
    }
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn
    }

    #[test]
    fn applies_every_migration_to_a_fresh_database() {
        let mut conn = open();
        let applied = run(&mut conn).expect("migrations apply");

        assert_eq!(
            applied.iter().map(|m| m.version).collect::<Vec<_>>(),
            MIGRATIONS.iter().map(|m| m.version).collect::<Vec<_>>()
        );
        assert_eq!(current_version(&conn).unwrap(), Some(4));
        assert!(column_exists(&conn, "users", "session_version").unwrap());
        assert!(index_exists(&conn, "reading_progress_user_book_unique").unwrap());
    }

    #[test]
    fn rerunning_migrations_is_a_no_op() {
        let mut conn = open();
        run(&mut conn).expect("first run");
        let second = run(&mut conn).expect("second run");
        assert!(second.is_empty(), "expected no migrations on rerun");
    }

    #[test]
    fn upgrades_a_legacy_database_without_replaying_the_baseline() {
        let mut conn = open();
        // Simulate a database created by the 0000 + 0001 era code with no ledger.
        for statement in split_statements(MIGRATIONS[0].sql) {
            conn.execute_batch(&statement).unwrap();
        }
        for statement in split_statements(MIGRATIONS[1].sql) {
            conn.execute_batch(&statement).unwrap();
        }
        let now = crate::db::unix_now();
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
             VALUES ('u1', 'owner@example.com', 'hash', 'Owner', 'admin', ?1, ?1)",
            params![now],
        )
        .unwrap();

        let applied = run(&mut conn).expect("legacy upgrade");

        assert_eq!(
            applied.iter().map(|m| m.version).collect::<Vec<_>>(),
            vec![3, 4],
            "0000-0002 are already satisfied and must not be replayed"
        );
        let preserved: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
            .unwrap();
        assert_eq!(preserved, 1, "existing accounts must survive the upgrade");
    }

    #[test]
    fn deduplicates_progress_rows_keeping_the_most_recent() {
        let mut conn = open();
        // Apply everything except the progress uniqueness migration.
        ensure_ledger(&conn).unwrap();
        for migration in &MIGRATIONS[..4] {
            apply(&mut conn, migration).unwrap();
        }

        let now = crate::db::unix_now();
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
             VALUES ('u1', 'r@example.com', 'h', 'R', 'user', ?1, ?1)",
            params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO books (id, title, file_type, file_path, file_size, file_hash, added_at, updated_at)
             VALUES ('b1', 'Book', 'epub', '/b1.epub', 1, 'hash1', ?1, ?1)",
            params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reading_progress (id, user_id, book_id, current_page, percent_complete, status, last_read_at)
             VALUES ('older', 'u1', 'b1', 3, 10.0, 'reading', ?1)",
            params![now - 100],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reading_progress (id, user_id, book_id, current_page, percent_complete, status, last_read_at)
             VALUES ('newer', 'u1', 'b1', 9, 42.0, 'reading', ?1)",
            params![now],
        )
        .unwrap();

        apply(&mut conn, &MIGRATIONS[4]).unwrap();

        let remaining: Vec<String> = conn
            .prepare("SELECT id FROM reading_progress")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(remaining, vec!["newer".to_string()]);

        // The unique index must now reject a second row for the same pair.
        let duplicate = conn.execute(
            "INSERT INTO reading_progress (id, user_id, book_id, current_page, percent_complete, status, last_read_at)
             VALUES ('dupe', 'u1', 'b1', 1, 1.0, 'reading', ?1)",
            params![now],
        );
        assert!(duplicate.is_err(), "duplicate progress must be rejected");
    }

    #[test]
    fn a_failing_migration_leaves_no_partial_state() {
        let mut conn = open();
        run(&mut conn).unwrap();

        let broken = Migration {
            version: 9_999,
            name: "broken",
            sql: "CREATE TABLE migration_probe (id TEXT PRIMARY KEY);\n\
                  --> statement-breakpoint\n\
                  THIS IS NOT SQL;",
        };

        let result = apply(&mut conn, &broken);
        assert!(result.is_err(), "invalid SQL must fail the migration");
        assert!(
            !table_exists(&conn, "migration_probe").unwrap(),
            "the first statement must be rolled back"
        );
        assert!(
            !is_applied(&conn, 9_999).unwrap(),
            "a failed migration must not be recorded as applied"
        );
    }
}
