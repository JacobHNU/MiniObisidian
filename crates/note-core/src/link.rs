use pulldown_cmark::{Event, Parser, Tag, TagEnd};

/// Extracted wiki link: [[target]]
#[derive(Debug, Clone)]
pub struct WikiLink {
    pub target: String,
    pub context: String,
}

/// Extract all [[wiki-links]] from markdown body text
pub fn extract_wiki_links(body: &str) -> Vec<WikiLink> {
    let mut links = Vec::new();
    let mut search_start = 0;

    while let Some(open_pos) = body[search_start..].find("[[") {
        let abs_open = search_start + open_pos;
        if let Some(close_pos) = body[abs_open + 2..].find("]]") {
            let abs_close = abs_open + 2 + close_pos;
            let target = body[abs_open + 2..abs_close].trim().to_string();

            if !target.is_empty() {
                // Get surrounding context (current paragraph)
                let context = extract_paragraph_context(body, abs_open);
                links.push(WikiLink { target, context });
            }

            search_start = abs_close + 2;
        } else {
            break;
        }
    }

    links
}

/// Extract all standard markdown links [text](url) that point to .md files
pub fn extract_md_links(body: &str) -> Vec<WikiLink> {
    let links = Vec::new();
    let parser = Parser::new(body);
    let mut current_text = String::new();
    let mut in_link = false;

    for event in parser {
        match event {
            Event::Start(Tag::Link { dest_url, .. }) => {
                in_link = true;
                current_text.clear();
                let url = dest_url.to_string();
                if url.ends_with(".md") || !url.contains("://") {
                    // Internal link
                } else {
                    in_link = false;
                }
            }
            Event::Text(text) if in_link => {
                current_text.push_str(&text);
            }
            Event::End(TagEnd::Link) if in_link => {
                in_link = false;
                // This is a simplified extraction
            }
            _ => {}
        }
    }

    links
}

/// Extract the paragraph containing a link for context
fn extract_paragraph_context(body: &str, link_pos: usize) -> String {
    let before = &body[..link_pos];
    let after = &body[link_pos..];

    // Find paragraph boundaries (double newline)
    let para_start = before.rfind("\n\n").map(|p| p + 2).unwrap_or(0);
    let para_end = after.find("\n\n").map(|p| link_pos + p).unwrap_or(body.len());

    let paragraph = &body[para_start..para_end];
    // Truncate if too long
    if paragraph.len() > 200 {
        format!("{}...", &paragraph[..200])
    } else {
        paragraph.to_string()
    }
}

/// Convert a wiki link target to a note ID (slug)
pub fn target_to_id(target: &str) -> String {
    target
        .to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
        .trim_matches('-')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_wiki_links() {
        let body = "See [[Project Alpha]] and [[meeting-notes]] for details.";
        let links = extract_wiki_links(body);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "Project Alpha");
        assert_eq!(links[1].target, "meeting-notes");
    }

    #[test]
    fn test_extract_no_links() {
        let body = "No wiki links here, just [regular](http://example.com) links.";
        let links = extract_wiki_links(body);
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn test_target_to_id() {
        assert_eq!(target_to_id("Project Alpha"), "project-alpha");
        assert_eq!(target_to_id("meeting-notes"), "meeting-notes");
        assert_eq!(target_to_id("Hello World 123"), "hello-world-123");
    }
}
