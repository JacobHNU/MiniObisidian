import { useRef, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import rehypeRaw from 'rehype-raw'
import * as api from '../../ipc/tauri'

interface EditorPanelProps {
  content: string
  onChange: (content: string) => void
  viewMode: 'edit' | 'preview' | 'split'
  currentNoteId?: string | null
}

// Cache for resolved attachment data URIs (persists across renders)
const attachmentCache = new Map<string, string>()

// Custom img component that resolves relative paths to data URIs
const MarkdownImg = ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src)

  useEffect(() => {
    if (!src) {
      setResolvedSrc(undefined)
      return
    }

    // Data URIs and external URLs - use directly
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
      setResolvedSrc(src)
      return
    }

    // Check cache first
    if (attachmentCache.has(src)) {
      setResolvedSrc(attachmentCache.get(src))
      return
    }

    // Relative path - resolve via backend
    let cancelled = false
    setResolvedSrc(undefined) // Clear while loading

    api.readAttachment(src).then((dataUri) => {
      if (!cancelled) {
        attachmentCache.set(src, dataUri)
        setResolvedSrc(dataUri)
      }
    }).catch((err) => {
      console.warn('[Img] Failed to resolve attachment:', src, err)
      if (!cancelled) {
        // Keep original src as fallback (will show broken image)
        setResolvedSrc(src)
      }
    })

    return () => { cancelled = true }
  }, [src])

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt}
      style={{ maxWidth: '100%', borderRadius: 8, margin: '8px 0', display: 'block' }}
    />
  )
}

// Custom markdown components
const mdComponents = {
  img: MarkdownImg,
}

export default function EditorPanel({ content, onChange, viewMode, currentNoteId }: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  // Handle tab key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const target = e.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      const newContent = content.substring(0, start) + '  ' + content.substring(end)
      onChange(newContent)
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2
      })
    }
  }

  // Handle paste (images and text)
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        try {
          const timestamp = Date.now()
          const ext = file.type.split('/')[1] || 'png'
          const filename = `paste-${timestamp}.${ext}`

          // Read file as base64
          const arrayBuffer = await file.arrayBuffer()
          const uint8Array = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i])
          }
          const base64 = btoa(binary)

          // Save to attachments folder
          const relPath = await api.saveAttachment(filename, base64)

          // Insert markdown image syntax (clean and short)
          const imgMarkdown = `![${filename}](${relPath})`

          const textarea = textareaRef.current
          if (textarea) {
            const currentValue = textarea.value
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const newValue = currentValue.substring(0, start) + imgMarkdown + currentValue.substring(end)
            onChange(newValue)
            requestAnimationFrame(() => {
              textarea.selectionStart = textarea.selectionEnd = start + imgMarkdown.length
              textarea.focus()
            })
          } else {
            onChange(content + '\n' + imgMarkdown)
          }
        } catch (err) {
          console.error('Image paste failed:', err)
        }
        return
      }
    }
  }

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current
    if (!textarea) {
      onChange(content + '\n' + text)
      return
    }
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = content.substring(0, start)
    const after = content.substring(end)
    const newContent = before + text + after
    onChange(newContent)
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + text.length
      textarea.focus()
    })
  }

  // Wiki link click handler
  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('wiki-link')) {
      const noteName = target.getAttribute('data-note')
      if (noteName) console.log('Navigate to note:', noteName)
    }
  }

  // Process content: convert wiki links to HTML (rehype-raw will render them)
  // Strip YAML frontmatter for preview
  const previewContent = useMemo(() => {
    let text = content

    // Strip YAML frontmatter
    const match = text.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
    if (match) text = match[1].trim()

    // Convert wiki-links to HTML spans (rehype-raw will render them)
    text = text.replace(
      /\[\[([^\]]+)\]\]/g,
      '<span class="wiki-link" data-note="$1">$1</span>'
    )

    return text
  }, [content])

  // Drag-to-resize handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = Math.min(Math.max((x / rect.width) * 100, 10), 90)
      setSplitRatio(pct)
    }
    const handleMouseUp = () => setIsDragging(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Textarea element shared across modes
  const renderTextarea = (extraClass?: string) => (
    <textarea
      ref={textareaRef}
      value={content}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={`w-full min-w-0 bg-transparent text-[#cdd6f4] resize-none focus:outline-none font-mono text-[15px] leading-relaxed ${extraClass || ''}`}
      style={{
        minHeight: 'calc(100vh - 120px)',
        whiteSpace: 'pre-wrap'
      }}
      placeholder="Start writing..."
      spellCheck={false}
    />
  )

  if (viewMode === 'edit') {
    return (
      <div className="h-full w-full overflow-y-auto">
        <div className="p-6">
          {renderTextarea()}
        </div>
      </div>
    )
  }

  if (viewMode === 'preview') {
    return (
      <div className="h-full w-full overflow-y-auto" onClick={handlePreviewClick}>
        <div className="p-6 markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFrontmatter]}
            rehypePlugins={[rehypeRaw]}
            components={mdComponents}
          >
            {previewContent}
          </ReactMarkdown>
        </div>
      </div>
    )
  }

  // Split view
  return (
    <div
      ref={containerRef}
      className="h-full w-full flex overflow-hidden"
      onClick={handlePreviewClick}
      style={{ cursor: isDragging ? 'col-resize' : undefined }}
    >
      <div className="overflow-y-auto overflow-x-hidden" style={{ width: `${splitRatio}%`, minWidth: 0 }}>
        <div className="p-4">
          {renderTextarea('min-h-[calc(100vh-120px)]')}
        </div>
      </div>

      <div
        className={`relative shrink-0 w-[5px] cursor-col-resize group transition-colors ${
          isDragging ? 'bg-[#cba6f7]' : 'bg-[#313244] hover:bg-[#585b70]'
        }`}
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 -left-[4px] -right-[4px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-[3px] h-[3px] rounded-full bg-[#a6adc8]" />
          <div className="w-[3px] h-[3px] rounded-full bg-[#a6adc8]" />
          <div className="w-[3px] h-[3px] rounded-full bg-[#a6adc8]" />
        </div>
      </div>

      <div className="overflow-y-auto overflow-x-hidden flex-1" style={{ minWidth: 0 }}>
        <div className="p-6 markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFrontmatter]}
            rehypePlugins={[rehypeRaw]}
            components={mdComponents}
          >
            {previewContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
