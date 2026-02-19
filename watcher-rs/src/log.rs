use chrono::Utc;

pub fn log(message: &str) {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    println!("[{now}] {message}");
}
