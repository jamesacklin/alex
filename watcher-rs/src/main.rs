use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use rusqlite::{
    Connection, Row, params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde::Deserialize;
use serde_json::{Map as JsonMap, Value as JsonValue, json};
use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use watcher_rs::db::Database;
use watcher_rs::s3::S3Config;

#[derive(Parser)]
#[command(
    name = "watcher-rs",
    about = "Watch a library directory for PDF and EPUB files"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,

    #[arg(long, env = "LIBRARY_PATH", default_value = "./data/library")]
    library_path: String,

    #[arg(long, env = "DATABASE_PATH", default_value = "./data/library.db")]
    db_path: String,

    #[arg(long, env = "COVERS_PATH", default_value = "./data/covers")]
    covers_path: String,

    // S3 configuration (optional — if S3_BUCKET is set, S3 mode is used instead of local)
    #[arg(long, env = "S3_ENDPOINT")]
    s3_endpoint: Option<String>,

    #[arg(long, env = "S3_REGION", default_value = "auto")]
    s3_region: String,

    #[arg(long, env = "S3_BUCKET")]
    s3_bucket: Option<String>,

    #[arg(long, env = "S3_ACCESS_KEY_ID")]
    s3_access_key: Option<String>,

    #[arg(long, env = "S3_SECRET_ACCESS_KEY")]
    s3_secret_key: Option<String>,

    #[arg(long, env = "S3_PREFIX")]
    s3_prefix: Option<String>,

    #[arg(long, env = "S3_POLL_INTERVAL", default_value = "60")]
    s3_poll_interval: u64,
}

#[derive(Subcommand)]
enum Command {
    Db(DbCommand),
    /// Stream an S3 object to stdout (used by the Next.js file-serving route).
    S3Stream(S3StreamCommand),
    /// Run the reverse tunnel client to expose the local server publicly.
    Tunnel(TunnelCommand),
    /// Verify that S3 credentials can list the configured bucket/prefix.
    S3Check(S3CheckCommand),
}

#[derive(Args)]
struct DbCommand {
    #[arg(long, env = "DATABASE_PATH", default_value = "./data/library.db")]
    db_path: String,

    #[command(subcommand)]
    action: DbAction,
}

#[derive(Subcommand)]
enum DbAction {
    QueryAll,
    QueryOne,
    Execute,
    /// Run every statement on one connection inside a single transaction.
    Transaction,
    /// Apply pending schema migrations. Exits non-zero if any migration fails.
    Migrate,
    /// Report the highest applied migration version without changing anything.
    MigrationStatus,
}

#[derive(Args)]
struct S3StreamCommand {
    /// S3 object key to stream.
    #[arg(long)]
    key: String,

    /// Optional HTTP Range header value (e.g. "bytes=0-1023").
    #[arg(long)]
    range: Option<String>,

    // S3 credentials (inherited from env vars by default)
    #[arg(long, env = "S3_ENDPOINT")]
    s3_endpoint: Option<String>,

    #[arg(long, env = "S3_REGION", default_value = "auto")]
    s3_region: String,

    #[arg(long, env = "S3_BUCKET")]
    s3_bucket: String,

    #[arg(long, env = "S3_ACCESS_KEY_ID")]
    s3_access_key: String,

    #[arg(long, env = "S3_SECRET_ACCESS_KEY")]
    s3_secret_key: String,
}

#[derive(Args)]
struct S3CheckCommand {
    #[arg(long, env = "S3_ENDPOINT")]
    s3_endpoint: Option<String>,

    #[arg(long, env = "S3_REGION", default_value = "auto")]
    s3_region: String,

    #[arg(long, env = "S3_BUCKET")]
    s3_bucket: String,

    #[arg(long, env = "S3_ACCESS_KEY_ID")]
    s3_access_key: String,

    #[arg(long, env = "S3_SECRET_ACCESS_KEY")]
    s3_secret_key: String,

    #[arg(long, env = "S3_PREFIX")]
    s3_prefix: Option<String>,
}

#[derive(Args)]
struct TunnelCommand {
    /// Three-word subdomain to register (e.g., "gentle-morning-tide").
    #[arg(long)]
    subdomain: String,

    /// WebSocket URL of the relay server.
    #[arg(long)]
    relay_url: String,

    /// Local address to forward requests to.
    #[arg(long, default_value = "127.0.0.1:3210")]
    local_addr: String,
}

#[derive(Deserialize)]
struct SqlRequest {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[derive(Deserialize)]
struct TransactionRequest {
    statements: Vec<TransactionStatement>,
}

#[derive(Deserialize)]
struct TransactionStatement {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
    #[serde(default)]
    mode: TransactionMode,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum TransactionMode {
    #[default]
    Execute,
    QueryOne,
    QueryAll,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Command::Db(cmd)) => run_db_command(cmd),
        Some(Command::S3Stream(cmd)) => run_s3_stream(cmd),
        Some(Command::Tunnel(cmd)) => run_tunnel(cmd),
        Some(Command::S3Check(cmd)) => run_s3_check(cmd),
        None => {
            // Auto-detect: if S3_BUCKET is set, run S3 watcher; otherwise local.
            if cli.s3_bucket.is_some() {
                run_s3_watcher(cli)
            } else {
                run_watcher(cli)
            }
        }
    }
}

fn run_watcher(args: Cli) -> Result<()> {
    // Ensure library directory exists
    std::fs::create_dir_all(&args.library_path)?;
    std::fs::create_dir_all(&args.covers_path)?;

    // Resolve to absolute path
    let library_path = std::fs::canonicalize(&args.library_path)?;
    let covers_path = std::fs::canonicalize(&args.covers_path)?;

    // Open database
    let db = Database::open(&args.db_path)?;

    // Set up shutdown signal
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_flag = Arc::clone(&shutdown);
    ctrlc::set_handler(move || {
        shutdown_flag.store(true, Ordering::Relaxed);
    })?;

    // Run the watcher (blocks until shutdown)
    watcher_rs::watcher::run(library_path, covers_path, db, shutdown)?;

    Ok(())
}

fn run_s3_watcher(args: Cli) -> Result<()> {
    let bucket = args
        .s3_bucket
        .as_ref()
        .context("S3_BUCKET is required for S3 mode")?;
    let access_key = args
        .s3_access_key
        .as_ref()
        .context("S3_ACCESS_KEY_ID is required for S3 mode")?;
    let secret_key = args
        .s3_secret_key
        .as_ref()
        .context("S3_SECRET_ACCESS_KEY is required for S3 mode")?;

    let config = S3Config {
        endpoint: args.s3_endpoint.clone(),
        region: args.s3_region.clone(),
        bucket: bucket.clone(),
        access_key: access_key.clone(),
        secret_key: secret_key.clone(),
        prefix: args.s3_prefix.clone(),
        poll_interval: args.s3_poll_interval,
    };

    std::fs::create_dir_all(&args.covers_path)?;
    let covers_path = std::fs::canonicalize(&args.covers_path)?;
    let db = Database::open(&args.db_path)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_flag = Arc::clone(&shutdown);
    ctrlc::set_handler(move || {
        shutdown_flag.store(true, Ordering::Relaxed);
    })?;

    // Create a tokio runtime for async S3 operations
    let rt = tokio::runtime::Runtime::new().context("Failed to create tokio runtime")?;
    rt.block_on(watcher_rs::s3::watcher::run(
        config,
        &covers_path,
        db,
        shutdown,
    ))?;

    Ok(())
}

fn run_s3_stream(cmd: S3StreamCommand) -> Result<()> {
    let config = S3Config {
        endpoint: cmd.s3_endpoint,
        region: cmd.s3_region,
        bucket: cmd.s3_bucket,
        access_key: cmd.s3_access_key,
        secret_key: cmd.s3_secret_key,
        prefix: None,
        poll_interval: 0,
    };

    let rt = tokio::runtime::Runtime::new().context("Failed to create tokio runtime")?;
    rt.block_on(watcher_rs::s3::stream::run(
        config,
        &cmd.key,
        cmd.range.as_deref(),
    ))?;

    Ok(())
}

/// Check that the supplied credentials can reach the bucket and prefix.
///
/// Used before a configuration change is activated, so a bad credential
/// rotation is reported instead of silently replacing a working source.
/// Prints `{"ok":true,"objects":N}` on success and exits non-zero with
/// `{"ok":false,"error":"..."}` on failure.
fn run_s3_check(cmd: S3CheckCommand) -> Result<()> {
    let config = S3Config {
        endpoint: cmd.s3_endpoint,
        region: cmd.s3_region,
        bucket: cmd.s3_bucket,
        access_key: cmd.s3_access_key,
        secret_key: cmd.s3_secret_key,
        prefix: cmd.s3_prefix.clone(),
        poll_interval: 0,
    };

    let rt = tokio::runtime::Runtime::new().context("Failed to create tokio runtime")?;
    let result = rt.block_on(async {
        let bucket = watcher_rs::s3::client::create_bucket(&config)?;
        watcher_rs::s3::scanner::list_objects(&bucket, config.prefix.as_deref()).await
    });

    match result {
        Ok(objects) => {
            println!("{}", json!({ "ok": true, "objects": objects.len() }));
            Ok(())
        }
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": format!("{error:#}") }));
            std::process::exit(1);
        }
    }
}

fn run_tunnel(cmd: TunnelCommand) -> Result<()> {
    let config = watcher_rs::tunnel::client::TunnelConfig {
        subdomain: cmd.subdomain,
        relay_url: cmd.relay_url,
        local_addr: cmd.local_addr,
    };

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    ctrlc::set_handler(move || {
        let _ = shutdown_tx.send(true);
    })?;

    watcher_rs::tunnel::run(config, shutdown_rx);
    Ok(())
}

fn run_db_command(cmd: DbCommand) -> Result<()> {
    // Migration commands take no stdin payload, so do not block waiting for one.
    match cmd.action {
        DbAction::Migrate => return run_db_migrate(&cmd.db_path),
        DbAction::MigrationStatus => return run_db_migration_status(&cmd.db_path),
        _ => {}
    }

    let mut stdin = String::new();
    std::io::stdin()
        .read_to_string(&mut stdin)
        .context("Failed to read SQL request from stdin")?;

    if matches!(cmd.action, DbAction::Transaction) {
        return run_db_transaction(&cmd.db_path, &stdin);
    }

    let request: SqlRequest = serde_json::from_str(&stdin).context("Invalid SQL request JSON")?;
    let bindings = to_sql_values(request.params)?;
    let conn = open_connection(&cmd.db_path)?;

    let output = match cmd.action {
        DbAction::QueryAll => {
            let rows = query_all(&conn, &request.sql, &bindings)?;
            json!({ "rows": rows })
        }
        DbAction::QueryOne => {
            let row = query_one(&conn, &request.sql, &bindings)?;
            json!({ "row": row })
        }
        DbAction::Execute => {
            let changes = conn
                .execute(&request.sql, params_from_iter(bindings.iter()))
                .with_context(|| format!("Failed to execute SQL: {}", request.sql))?;
            json!({ "changes": changes })
        }
        DbAction::Transaction | DbAction::Migrate | DbAction::MigrationStatus => {
            unreachable!("handled above")
        }
    };

    println!(
        "{}",
        serde_json::to_string(&output).context("Failed to serialize DB output")?
    );
    Ok(())
}

fn run_db_migrate(db_path: &str) -> Result<()> {
    if let Some(parent) = std::path::Path::new(db_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("Failed to create database directory {}", parent.display())
            })?;
        }
    }

    let mut conn = open_connection(db_path)?;
    let applied = watcher_rs::migrations::run(&mut conn)?;
    let current = watcher_rs::migrations::current_version(&conn)?;

    let output = json!({
        "applied": applied
            .iter()
            .map(|m| json!({ "version": m.version, "name": m.name }))
            .collect::<Vec<_>>(),
        "version": current,
    });

    println!(
        "{}",
        serde_json::to_string(&output).context("Failed to serialize migration output")?
    );
    Ok(())
}

fn run_db_migration_status(db_path: &str) -> Result<()> {
    let conn = open_connection(db_path)?;
    let current = watcher_rs::migrations::current_version(&conn)?;
    let latest = watcher_rs::migrations::MIGRATIONS
        .iter()
        .map(|m| m.version)
        .max();

    let output = json!({
        "version": current,
        "latest": latest,
        "upToDate": current.is_some() && current == latest,
    });

    println!(
        "{}",
        serde_json::to_string(&output).context("Failed to serialize migration status")?
    );
    Ok(())
}

/// Run a batch of statements on one connection inside one transaction.
///
/// Node's DB bridge spawns a process per call, so `BEGIN` and `COMMIT` sent
/// as separate `execute` calls are not a transaction.  This command is the
/// real primitive: every statement shares a connection, and any error rolls
/// the whole batch back.
fn run_db_transaction(db_path: &str, stdin: &str) -> Result<()> {
    let request: TransactionRequest =
        serde_json::from_str(stdin).context("Invalid transaction request JSON")?;

    let mut conn = open_connection(db_path)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .context("Failed to begin transaction")?;

    let mut results = Vec::with_capacity(request.statements.len());
    for statement in request.statements {
        let bindings = to_sql_values(statement.params)?;
        let result = match statement.mode {
            TransactionMode::Execute => {
                let changes = tx
                    .execute(&statement.sql, params_from_iter(bindings.iter()))
                    .with_context(|| format!("Failed to execute SQL: {}", statement.sql))?;
                json!({ "changes": changes })
            }
            TransactionMode::QueryOne => {
                let row = query_one(&tx, &statement.sql, &bindings)?;
                json!({ "row": row })
            }
            TransactionMode::QueryAll => {
                let rows = query_all(&tx, &statement.sql, &bindings)?;
                json!({ "rows": rows })
            }
        };
        results.push(result);
    }

    tx.commit().context("Failed to commit transaction")?;

    println!(
        "{}",
        serde_json::to_string(&json!({ "results": results }))
            .context("Failed to serialize transaction output")?
    );
    Ok(())
}

fn open_connection(path: &str) -> Result<Connection> {
    let conn =
        Connection::open(path).with_context(|| format!("Failed to open database at {path}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
    .context("Failed to initialize SQLite pragmas")?;
    Ok(conn)
}

fn to_sql_values(params: Vec<JsonValue>) -> Result<Vec<SqlValue>> {
    params
        .into_iter()
        .map(|value| match value {
            JsonValue::Null => Ok(SqlValue::Null),
            JsonValue::Bool(flag) => Ok(SqlValue::Integer(if flag { 1 } else { 0 })),
            JsonValue::Number(number) => {
                if let Some(int) = number.as_i64() {
                    Ok(SqlValue::Integer(int))
                } else if let Some(float) = number.as_f64() {
                    Ok(SqlValue::Real(float))
                } else {
                    Err(anyhow::anyhow!("Unsupported JSON number parameter"))
                }
            }
            JsonValue::String(text) => Ok(SqlValue::Text(text)),
            JsonValue::Array(_) | JsonValue::Object(_) => {
                Err(anyhow::anyhow!("Unsupported SQL parameter type"))
            }
        })
        .collect()
}

fn query_all(
    conn: &Connection,
    sql: &str,
    bindings: &[SqlValue],
) -> Result<Vec<JsonMap<String, JsonValue>>> {
    let mut stmt = conn
        .prepare(sql)
        .with_context(|| format!("Failed to prepare SQL: {sql}"))?;
    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let mut rows = stmt
        .query(params_from_iter(bindings.iter()))
        .with_context(|| format!("Failed to run SQL query: {sql}"))?;

    let mut output = Vec::new();
    while let Some(row) = rows.next().context("Failed to read SQL row")? {
        output.push(row_to_json(row, &column_names)?);
    }

    Ok(output)
}

fn query_one(
    conn: &Connection,
    sql: &str,
    bindings: &[SqlValue],
) -> Result<Option<JsonMap<String, JsonValue>>> {
    let mut stmt = conn
        .prepare(sql)
        .with_context(|| format!("Failed to prepare SQL: {sql}"))?;
    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let mut rows = stmt
        .query(params_from_iter(bindings.iter()))
        .with_context(|| format!("Failed to run SQL query: {sql}"))?;

    if let Some(row) = rows.next().context("Failed to read SQL row")? {
        return Ok(Some(row_to_json(row, &column_names)?));
    }

    Ok(None)
}

fn row_to_json(row: &Row<'_>, column_names: &[String]) -> Result<JsonMap<String, JsonValue>> {
    let mut output = JsonMap::new();

    for (index, name) in column_names.iter().enumerate() {
        let value = match row.get_ref(index).context("Failed to read SQL column")? {
            ValueRef::Null => JsonValue::Null,
            ValueRef::Integer(v) => JsonValue::from(v),
            ValueRef::Real(v) => JsonValue::from(v),
            ValueRef::Text(v) => JsonValue::String(String::from_utf8_lossy(v).to_string()),
            ValueRef::Blob(v) => {
                JsonValue::Array(v.iter().map(|byte| JsonValue::from(*byte)).collect())
            }
        };

        output.insert(name.clone(), value);
    }

    Ok(output)
}
