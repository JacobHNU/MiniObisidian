use anyhow::Result;
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use tracing::info;

use storage::schema::NoteMeta;

use std::sync::LazyLock;

/// Search result with highlighted matches
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub score: f32,
}

/// Full-text search engine using Tantivy
pub struct SearchEngine {
    index: Index,
    reader: IndexReader,
    title_field: Field,
    content_field: Field,
    id_field: Field,
    path_field: Field,
}

impl SearchEngine {
    /// Create a new search engine or open existing index
    pub fn new(index_path: &Path) -> Result<Self> {
        let mut schema_builder = Schema::builder();

        // Define schema fields
        let title_field = schema_builder.add_text_field("title", TEXT | STORED);
        let content_field = schema_builder.add_text_field("content", TEXT | STORED);
        let id_field = schema_builder.add_text_field("id", STRING | STORED);
        let path_field = schema_builder.add_text_field("path", STRING | STORED);

        let schema = schema_builder.build();

        // Open or create index
        // Check for tantivy index files (meta.json), not just directory existence
        let has_index = index_path.join("meta.json").exists();
        let index = if has_index {
            Index::open_in_dir(index_path)?
        } else {
            std::fs::create_dir_all(index_path)?;
            Index::create_in_dir(index_path, schema.clone())?
        };

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()?;

        Ok(Self {
            index,
            reader,
            title_field,
            content_field,
            id_field,
            path_field,
        })
    }

    /// Index a single note (lightweight writer for single-doc updates)
    pub fn index_note(&self, note: &NoteMeta, content: &str) -> Result<()> {
        let mut writer: IndexWriter = self.index.writer(15_000_000)?; // 15MB heap (tantivy minimum)

        // Remove existing document if any
        writer.delete_term(tantivy::Term::from_field_text(self.id_field, &note.id));

        // Add new document (prepend tags to content so they are searchable)
        let indexed_content = if note.tags.is_empty() {
            content.to_string()
        } else {
            format!("{}\n{}", note.tags.join(" "), content)
        };
        writer.add_document(doc!(
            self.id_field => note.id.clone(),
            self.title_field => note.title.clone(),
            self.content_field => indexed_content,
            self.path_field => note.path.clone(),
        ))?;

        writer.commit()?;
        // Force reader to reload so newly indexed docs are immediately searchable
        self.reader.reload()?;
        Ok(())
    }

    /// Index all notes from the vault
    pub fn index_all_notes(&self, notes: &[(NoteMeta, String)]) -> Result<()> {
        let mut writer: IndexWriter = self.index.writer(100_000_000)?; // 100MB heap

        // Clear existing index
        writer.delete_all_documents()?;

        // Add all notes
        for (note, content) in notes {
            // Prepend tags to content so they are searchable
            let indexed_content = if note.tags.is_empty() {
                content.clone()
            } else {
                format!("{}\n{}", note.tags.join(" "), content)
            };
            writer.add_document(doc!(
                self.id_field => note.id.clone(),
                self.title_field => note.title.clone(),
                self.content_field => indexed_content,
                self.path_field => note.path.clone(),
            ))?;
        }

        writer.commit()?;
        self.reader.reload()?;
        info!("Indexed {} notes", notes.len());
        Ok(())
    }

    /// Search for notes matching the query
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        let searcher = self.reader.searcher();
        let query_str = query;

        // Create query parser that searches both title and content
        let query_parser = QueryParser::for_index(
            &self.index,
            vec![self.title_field, self.content_field],
        );

        // Parse query with jieba segmentation for Chinese support
        let tokenized_query = tokenize_text(query);
        let parsed_query = query_parser.parse_query(&tokenized_query)?;

        // Execute search
        let top_docs = searcher.search(&parsed_query, &TopDocs::with_limit(limit))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let doc = searcher.doc::<tantivy::TantivyDocument>(doc_address)?;

            let note_id = doc
                .get_first(self.id_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let title = doc
                .get_first(self.title_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let path = doc
                .get_first(self.path_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let content = doc
                .get_first(self.content_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Generate snippet (first 200 chars of content)
            let snippet = generate_snippet(&content, query_str, 200);

            results.push(SearchResult {
                note_id,
                title,
                path,
                snippet,
                score,
            });
        }

        Ok(results)
    }

    /// Get the number of indexed documents
    pub fn doc_count(&self) -> u64 {
        let searcher = self.reader.searcher();
        searcher.num_docs()
    }
}

/// Shared Jieba instance (loaded once, reused across all searches)
static JIEBA: LazyLock<jieba_rs::Jieba> = LazyLock::new(jieba_rs::Jieba::new);

/// Tokenize text using jieba for Chinese support
fn tokenize_text(text: &str) -> String {
    let words = JIEBA.cut(text, false);
    words.join(" ")
}

/// Generate a snippet from content with highlighted query terms
fn generate_snippet(content: &str, query: &str, max_len: usize) -> String {
    let query_lower = query.to_lowercase();
    let content_lower = content.to_lowercase();

    // Find the first occurrence of any query term
    let mut best_pos = content.len();
    for term in query_lower.split_whitespace() {
        if let Some(pos) = content_lower.find(term) {
            best_pos = best_pos.min(pos);
        }
    }

    // Extract snippet around the match
    let start = best_pos.saturating_sub(50);
    let end = (start + max_len).min(content.len());

    // Ensure we don't slice in the middle of a multi-byte UTF-8 character
    let start = adjust_to_char_boundary(content, start);
    let end = adjust_to_char_boundary(content, end);

    let snippet = &content[start..end];

    // Add ellipsis if needed
    if start > 0 {
        format!("...{}", snippet)
    } else if end < content.len() {
        format!("{}...", snippet)
    } else {
        snippet.to_string()
    }
}

/// Adjust byte offset to a valid UTF-8 char boundary
fn adjust_to_char_boundary(s: &str, mut pos: usize) -> usize {
    while pos < s.len() && !s.is_char_boundary(pos) {
        pos += 1;
    }
    pos.min(s.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_search_engine() {
        let dir = tempdir().unwrap();
        let engine = SearchEngine::new(dir.path()).unwrap();

        // Create a test note
        let note = NoteMeta {
            id: "test-1".to_string(),
            title: "Test Note".to_string(),
            tags: vec![],
            path: "test.md".to_string(),
            content_hash: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };

        // Index the note
        engine.index_note(&note, "This is a test note about Rust programming.").unwrap();

        // Search
        let results = engine.search("Rust", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "test-1");
        assert!(results[0].snippet.contains("Rust"));
    }

    #[test]
    fn test_tokenize_chinese() {
        let text = "这是一个测试文本";
        let tokenized = tokenize_text(text);
        // Jieba should segment Chinese text
        assert!(tokenized.contains(" "));
    }
}
