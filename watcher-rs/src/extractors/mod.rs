pub mod epub;
pub mod pdf;

pub struct BookMetadata {
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub page_count: Option<u32>,
    pub cover_path: Option<String>,
}
