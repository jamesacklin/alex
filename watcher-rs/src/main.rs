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
}

#[derive(Subcommand)]
enum Command {
    Db(DbCommand),
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
}

#[derive(Deserialize)]
struct SqlRequest {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Command::Db(cmd)) => run_db_command(cmd),
        None => run_watcher(cli),
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

fn run_db_command(cmd: DbCommand) -> Result<()> {
    let mut stdin = String::new();
    std::io::stdin()
        .read_to_string(&mut stdin)
        .context("Failed to read SQL request from stdin")?;

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
    };

    println!(
        "{}",
        serde_json::to_string(&output).context("Failed to serialize DB output")?
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
