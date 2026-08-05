/**
 * Multi-format document export utilities.
 *
 * Uses existing libraries (html2pdf.js) for PDF, and native HTML/XML for DOC/DOCX.
 */

import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs'

// ── PDF Export ─────────────────────────────────────────────────────

export async function exportToPdf(
  htmlElement: HTMLElement,
  title: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.('Generating PDF...')

  // @ts-ignore - html2pdf.js lacks type declarations
  const html2pdf = (await import('html2pdf.js')).default

  const opt = {
    margin: [15, 15, 15, 15],
    filename: `${title}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  }

  const blob: Blob = await html2pdf().set(opt).from(htmlElement).output('blob')
  const arrayBuffer = await blob.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)

  const filePath = await save({
    defaultPath: `${title}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (filePath) {
    try {
      await writeFile(filePath, uint8)
      onProgress?.('PDF exported!')
    } catch (e) {
      console.error('writeFile failed, trying fallback:', e)
      // Fallback: use Tauri invoke to write via backend
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_export_file', { path: filePath, data: Array.from(uint8) })
      onProgress?.('PDF exported!')
    }
  }
}

// ── DOC Export (HTML-based, Word compatible) ───────────────────────

export async function exportToDoc(
  htmlContent: string,
  title: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.('Generating DOC...')

  const docHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; max-width: 800px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28px; border-bottom: 2px solid #eee; padding-bottom: 8px; }
  h2 { font-size: 22px; margin-top: 24px; }
  h3 { font-size: 18px; margin-top: 20px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: Consolas, monospace; font-size: 13px; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 16px 0; padding: 8px 16px; color: #666; background: #fafafa; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  a { color: #0066cc; text-decoration: none; }
  hr { border: none; border-top: 2px solid #eee; margin: 24px 0; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
</style>
</head>
<body>
${htmlContent}
</body>
</html>`

  const filePath = await save({
    defaultPath: `${title}.doc`,
    filters: [{ name: 'Word Document', extensions: ['doc'] }],
  })

  if (filePath) {
    try {
      await writeTextFile(filePath, docHtml)
      onProgress?.('DOC exported!')
    } catch (e) {
      console.error('writeTextFile failed, trying fallback:', e)
      const { invoke } = await import('@tauri-apps/api/core')
      const encoder = new TextEncoder()
      await invoke('write_export_file', { path: filePath, data: Array.from(encoder.encode(docHtml)) })
      onProgress?.('DOC exported!')
    }
  }
}

// ── DOCX Export (proper OOXML format) ─────────────────────────────

export async function exportToDocx(
  htmlContent: string,
  title: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  onProgress?.('Generating DOCX...')

  const docxData = buildMinimalDocx(title, htmlContent)

  const filePath = await save({
    defaultPath: `${title}.docx`,
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  })

  if (filePath) {
    try {
      await writeFile(filePath, docxData)
      onProgress?.('DOCX exported!')
    } catch (e) {
      console.error('writeFile failed, trying fallback:', e)
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_export_file', { path: filePath, data: Array.from(docxData) })
      onProgress?.('DOCX exported!')
    }
  }
}

// ── DOCX Builder (minimal OOXML) ──────────────────────────────────

function buildMinimalDocx(title: string, htmlBody: string): Uint8Array {
  // Convert HTML to simple paragraphs for DOCX
  const paragraphs = htmlToDocxParagraphs(htmlBody)

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`

  // Build ZIP manually
  const files = [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/_rels/document.xml.rels', content: wordRels },
    { name: 'word/document.xml', content: document },
  ]

  return buildZip(files)
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function htmlToDocxParagraphs(html: string): string {
  // Simple HTML to DOCX paragraph conversion
  // Strip HTML tags and convert to paragraphs
  const lines = html
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<\/h1>/gi, '\n')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<\/h2>/gi, '\n')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<\/h3>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<hr[^>]*>/gi, '\n────────────────\n')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const parts = lines.split('\n')
  let result = ''

  for (const line of parts) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let isHeading = false
    let headingLevel = 0
    let text = trimmed

    if (trimmed.startsWith('### ')) {
      isHeading = true
      headingLevel = 3
      text = trimmed.slice(4)
    } else if (trimmed.startsWith('## ')) {
      isHeading = true
      headingLevel = 2
      text = trimmed.slice(3)
    } else if (trimmed.startsWith('# ')) {
      isHeading = true
      headingLevel = 1
      text = trimmed.slice(2)
    }

    const escapedText = escapeXml(text)

    if (isHeading) {
      const sizes = [0, 36, 28, 24] // half-points
      result += `<w:p><w:pPr><w:pStyle w:val="Heading${headingLevel}"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${sizes[headingLevel]}"/></w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r></w:p>`
    } else if (trimmed.startsWith('• ')) {
      result += `<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(trimmed)}</w:t></w:r></w:p>`
    } else if (trimmed.startsWith('> ')) {
      result += `<w:p><w:pPr><w:ind w:left="720"/><w:pStyle w:val="Quote"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">${escapeXml(trimmed.slice(2))}</w:t></w:r></w:p>`
    } else if (trimmed === '────────────────') {
      result += `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`
    } else {
      // Handle inline formatting (bold, italic, code)
      const formatted = formatInlineRuns(trimmed)
      result += `<w:p><w:r><w:t xml:space="preserve">${formatted}</w:t></w:r></w:p>`
    }
  }

  return result
}

function formatInlineRuns(text: string): string {
  // For simplicity, strip markdown formatting markers but keep the text
  return escapeXml(
    text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
      .replace(/\*(.+?)\*/g, '$1')       // italic
      .replace(/`(.+?)`/g, '$1')         // code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
  )
}

// Minimal ZIP file builder (no compression, stored method)
function buildZip(files: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder()
  const entries: { header: Uint8Array; data: Uint8Array }[] = []
  let offset = 0

  // Build local file entries
  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const dataBytes = encoder.encode(file.content)

    // CRC32
    const crc = crc32(dataBytes)

    // Local file header (30 + nameLen + dataLen)
    const header = new ArrayBuffer(30 + nameBytes.length)
    const view = new DataView(header)
    const arr = new Uint8Array(header)

    view.setUint32(0, 0x04034b50, true)  // signature
    view.setUint16(4, 20, true)          // version needed
    view.setUint16(6, 0, true)           // flags
    view.setUint16(8, 0, true)           // compression (stored)
    view.setUint16(10, 0, true)          // mod time
    view.setUint16(12, 0, true)          // mod date
    view.setUint32(14, crc, true)        // crc32
    view.setUint32(18, dataBytes.length, true)  // compressed size
    view.setUint32(22, dataBytes.length, true)  // uncompressed size
    view.setUint16(26, nameBytes.length, true)  // name length
    view.setUint16(28, 0, true)          // extra length
    arr.set(nameBytes, 30)

    entries.push({ header: arr, data: dataBytes })
  }

  // Build central directory
  const centralDir: Uint8Array[] = []
  let centralOffset = 0

  for (let i = 0; i < files.length; i++) {
    const entry = entries[i]
    const nameBytes = encoder.encode(files[i].name)
    const dataBytes = entry.data
    const crc = crc32(dataBytes)

    const cd = new ArrayBuffer(46 + nameBytes.length)
    const view = new DataView(cd)
    const arr = new Uint8Array(cd)

    view.setUint32(0, 0x02014b50, true)  // central directory signature
    view.setUint16(4, 20, true)          // version made by
    view.setUint16(6, 20, true)          // version needed
    view.setUint16(8, 0, true)           // flags
    view.setUint16(10, 0, true)          // compression
    view.setUint16(12, 0, true)          // mod time
    view.setUint16(14, 0, true)          // mod date
    view.setUint32(16, crc, true)        // crc32
    view.setUint32(20, dataBytes.length, true)  // compressed
    view.setUint32(24, dataBytes.length, true)  // uncompressed
    view.setUint16(28, nameBytes.length, true)  // name length
    view.setUint16(30, 0, true)          // extra length
    view.setUint16(32, 0, true)          // comment length
    view.setUint16(34, 0, true)          // disk number
    view.setUint16(36, 0, true)          // internal attrs
    view.setUint32(38, 0, true)          // external attrs
    view.setUint32(42, offset, true)     // local header offset
    arr.set(nameBytes, 46)

    centralDir.push(arr)
    offset += entry.header.length + entry.data.length
  }

  const centralDirOffset = offset
  let centralDirSize = 0
  for (const cd of centralDir) centralDirSize += cd.length

  // End of central directory
  const eocd = new ArrayBuffer(22)
  const eocdView = new DataView(eocd)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(4, 0, true)
  eocdView.setUint16(6, 0, true)
  eocdView.setUint16(8, files.length, true)
  eocdView.setUint16(10, files.length, true)
  eocdView.setUint32(12, centralDirSize, true)
  eocdView.setUint32(16, centralDirOffset, true)
  eocdView.setUint16(20, 0, true)

  // Combine all parts
  const totalSize = offset + centralDirSize + 22
  const result = new Uint8Array(totalSize)
  let pos = 0

  for (let i = 0; i < files.length; i++) {
    result.set(entries[i].header, pos)
    pos += entries[i].header.length
    result.set(entries[i].data, pos)
    pos += entries[i].data.length
  }

  for (const cd of centralDir) {
    result.set(cd, pos)
    pos += cd.length
  }

  result.set(new Uint8Array(eocd), pos)

  return result
}

// CRC32 implementation
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── Markdown to HTML helper ────────────────────────────────────────

export function markdownToHtml(markdown: string): string {
  let html = markdown

  // Strip YAML frontmatter
  html = html.replace(/^---\n[\s\S]*?\n---\n?/, '')

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6 style="padding-left:1.5em">$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 style="padding-left:1.5em">$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4 style="padding-left:1.5em">$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="padding-left:1.5em">$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>')
  html = html.replace(/^\*\*\*+$/gm, '<hr>')

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    return `<pre><code class="language-${lang}">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`
  })

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')

  // Images
  html = html.replace(/!\[(.+?)\]\((.+?)\)/g, '<img alt="$1" src="$2">')

  // Unordered lists (with nesting support)
  html = html.replace(/^([ \t]*)([-*])\s+(.+)$/gm, (_m, indent, _marker, text) => {
    const level = Math.floor(indent.length / 2)
    return `<li data-level="${level}">${text}</li>`
  })
  html = html.replace(/((?:<li data-level="\d+">.*<\/li>\n?)+)/g, (match) => {
    const items = match.match(/<li data-level="(\d+)">(.*?)<\/li>/g) || []
    let result = ''
    let prevLevel = -1
    for (const item of items) {
      const levelMatch = item.match(/<li data-level="(\d+)">(.*?)<\/li>/)
      if (!levelMatch) continue
      const level = parseInt(levelMatch[1])
      const text = levelMatch[2]
      while (level > prevLevel) { result += '<ul>'; prevLevel++ }
      while (level < prevLevel) { result += '</ul>'; prevLevel-- }
      result += `<li>${text}</li>`
    }
    while (prevLevel >= 0) { result += '</ul>'; prevLevel-- }
    return result
  })

  // Ordered lists (with nesting support)
  html = html.replace(/^([ \t]*)(\d+)\.\s+(.+)$/gm, (_m, indent, _num, text) => {
    const level = Math.floor(indent.length / 2)
    return `<oli data-level="${level}">${text}</oli>`
  })
  html = html.replace(/((?:<oli data-level="\d+">.*<\/oli>\n?)+)/g, (match) => {
    const items = match.match(/<oli data-level="(\d+)">(.*?)<\/oli>/g) || []
    let result = ''
    let prevLevel = -1
    for (const item of items) {
      const levelMatch = item.match(/<oli data-level="(\d+)">(.*?)<\/oli>/)
      if (!levelMatch) continue
      const level = parseInt(levelMatch[1])
      const text = levelMatch[2]
      while (level > prevLevel) { result += '<ol>'; prevLevel++ }
      while (level < prevLevel) { result += '</ol>'; prevLevel-- }
      result += `<li>${text}</li>`
    }
    while (prevLevel >= 0) { result += '</ol>'; prevLevel-- }
    return result
  })

  // Tables (basic)
  html = html.replace(/^\|(.+)\|$/gm, (_m, content) => {
    const cells = content.split('|').map((c: string) => c.trim())
    if (cells.every((c: string) => /^[-:]+$/.test(c))) return '' // separator row
    const tag = 'td'
    const row = cells.map((c: string) => `<${tag}>${c}</${tag}>`).join('')
    return `<tr>${row}</tr>`
  })
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')

  // Checkboxes
  html = html.replace(/\[x\]/g, '☑')
  html = html.replace(/\[ \]/g, '☐')

  // Paragraphs (wrap remaining text lines)
  html = html.replace(/^(?!<[a-z])((?!^\s*$).+)$/gm, '<p>$1</p>')

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')

  return html
}
