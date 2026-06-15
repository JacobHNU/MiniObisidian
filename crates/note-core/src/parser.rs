use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Parsed note with frontmatter and body separated
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedNote {
    pub frontmatter: Frontmatter,
    pub body: String,
    pub raw_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Frontmatter {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub updated: Option<String>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub ai_summary: Option<String>,
}

/// Parse a markdown file content into frontmatter + body
pub fn parse_note(content: &str) -> Result<ParsedNote> {
    let (frontmatter, body) = extract_frontmatter(content);

    Ok(ParsedNote {
        frontmatter,
        body: body.to_string(),
        raw_content: content.to_string(),
    })
}

/// Extract YAML frontmatter from markdown content
fn extract_frontmatter(content: &str) -> (Frontmatter, &str) {
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return (Frontmatter::default(), content);
    }

    // Find the closing ---
    let after_open = &trimmed[3..];
    if let Some(end_pos) = after_open.find("\n---") {
        let yaml_str = &after_open[..end_pos];
        let body_start = end_pos + 4 + 3; // "\n---" + "---"
        let body = if body_start < trimmed.len() {
            trimmed[body_start..].trim_start_matches('\n')
        } else {
            ""
        };

        match serde_yaml::from_str::<Frontmatter>(yaml_str) {
            Ok(fm) => (fm, body),
            Err(_) => (Frontmatter::default(), content),
        }
    } else {
        (Frontmatter::default(), content)
    }
}

/// Generate frontmatter YAML string from a Frontmatter struct
pub fn serialize_frontmatter(fm: &Frontmatter) -> String {
    let mut lines = vec!["---".to_string()];

    if let Some(ref id) = fm.id {
        lines.push(format!("id: \"{}\"", id));
    }
    if !fm.title.is_empty() {
        lines.push(format!("title: \"{}\"", fm.title.replace('"', "\\\"")));
    }
    if !fm.tags.is_empty() {
        let tags_str = fm.tags.iter().map(|t| format!("\"{}\"", t)).collect::<Vec<_>>().join(", ");
        lines.push(format!("tags: [{}]", tags_str));
    }
    if let Some(ref created) = fm.created {
        lines.push(format!("created: \"{}\"", created));
    }
    if let Some(ref updated) = fm.updated {
        lines.push(format!("updated: \"{}\"", updated));
    }
    if !fm.links.is_empty() {
        let links_str = fm.links.iter().map(|l| format!("\"{}\"", l)).collect::<Vec<_>>().join(", ");
        lines.push(format!("links: [{}]", links_str));
    }
    if let Some(ref summary) = fm.ai_summary {
        lines.push(format!("ai_summary: \"{}\"", summary.replace('"', "\\\"")));
    }

    lines.push("---".to_string());
    lines.join("\n")
}

/// Rebuild note content with updated frontmatter
pub fn rebuild_note_content(fm: &Frontmatter, body: &str) -> String {
    format!("{}\n\n{}", serialize_frontmatter(fm), body.trim())
}

/// Compute SHA-256 hash of content
pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_with_frontmatter() {
        let content = r#"---
title: "Test Note"
tags: ["rust", "tauri"]
created: "2026-06-15T10:00:00+08:00"
---

## Hello World

This is the body."#;

        let parsed = parse_note(content).unwrap();
        assert_eq!(parsed.frontmatter.title, "Test Note");
        assert_eq!(parsed.frontmatter.tags, vec!["rust", "tauri"]);
        assert!(parsed.body.contains("Hello World"));
    }

    #[test]
    fn test_parse_without_frontmatter() {
        let content = "## Simple Note\n\nNo frontmatter here.";
        let parsed = parse_note(content).unwrap();
        assert!(parsed.frontmatter.title.is_empty());
        assert!(parsed.body.contains("Simple Note"));
    }

    #[test]
    fn test_content_hash() {
        let h1 = content_hash("hello");
        let h2 = content_hash("hello");
        let h3 = content_hash("world");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
    }
}
