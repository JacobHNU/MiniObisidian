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
    let mut links = Vec::new();
    let parser = Parser::new(body);
    let mut current_text = String::new();
    let mut current_url = String::new();
    let mut in_link = false;

    for event in parser {
        match event {
            Event::Start(Tag::Link { dest_url, .. }) => {
                in_link = true;
                current_text.clear();
                current_url = dest_url.to_string();
            }
            Event::Text(text) if in_link => {
                current_text.push_str(&text);
            }
            Event::End(TagEnd::Link) if in_link => {
                in_link = false;
                
                // Check if this is an internal link (points to .md file or relative path)
                let is_internal = current_url.ends_with(".md") || 
                    (!current_url.contains("://") && !current_url.starts_with("mailto:"));
                
                if is_internal && !current_text.is_empty() {
                    // Extract the target from URL (remove .md extension if present)
                    let target = if current_url.ends_with(".md") {
                        current_url[..current_url.len() - 3].to_string()
                    } else {
                        current_url.clone()
                    };
                    
                    // Get surrounding context (current paragraph)
                    // Note: We need to calculate position differently since we're using parser
                    let context = format!("Link: [{}]({})", current_text, current_url);
                    
                    links.push(WikiLink { 
                        target: target, 
                        context: context 
                    });
                }
                
                current_text.clear();
                current_url.clear();
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
    // Truncate if too long (use chars to avoid UTF-8 boundary panic)
    if paragraph.len() > 200 {
        let truncated: String = paragraph.chars().take(200).collect();
        format!("{}...", truncated)
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
    fn test_extract_md_links() {
        let body = r#"This is a [link to notes](meeting-notes.md) and [another](project.md).
        
External [Google](https://google.com) should be ignored.
        
Also [relative link](docs/readme.md) should be included."#;
        
        let links = extract_md_links(body);
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].target, "meeting-notes");
        assert_eq!(links[1].target, "project");
        assert_eq!(links[2].target, "docs/readme");
    }

    #[test]
    fn test_extract_md_links_no_external() {
        let body = "External [Google](https://google.com) and [Email](mailto:test@example.com) should be ignored.";
        let links = extract_md_links(body);
        assert_eq!(links.len(), 0);
    }

    #[test]
    fn test_target_to_id() {
        assert_eq!(target_to_id("Project Alpha"), "project-alpha");
        assert_eq!(target_to_id("meeting-notes"), "meeting-notes");
        assert_eq!(target_to_id("Hello World 123"), "hello-world-123");
    }
}
