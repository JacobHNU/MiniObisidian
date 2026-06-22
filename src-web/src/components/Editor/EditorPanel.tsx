import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'
import CodeMirrorEditor from './CodeMirrorEditor'
import PDFCanvas from '../PDF/PDFCanvas'
import SelectionToolbar from './SelectionToolbar'

interface EditorPanelProps {
  content: string
  onChange: (content: string) => void
  viewMode: 'edit' | 'preview' | 'split'
  currentNoteId?: string | null
  onWikiLinkClick?: (noteTitle: string) => void
  isPdf?: boolean
  pdfDataUrl?: string
  onSendToAI?: (text: string) => void
  onToast?: (message: string, type: 'success' | 'error') => void
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
  input: ({ checked, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="task-checkbox"
          {...props}
        />
      )
    }
    return <input type={type} {...props} />
  },
}

export default function EditorPanel({ content, onChange, viewMode, currentNoteId, onWikiLinkClick, isPdf, pdfDataUrl, onSendToAI, onToast }: EditorPanelProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  // Handle image paste from CodeMirror
  const handlePasteImage = useCallback(async (file: File) => {
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

      // Insert markdown image syntax at the end of content
      const imgMarkdown = `![${filename}](${relPath})`
      onChange(content + '\n' + imgMarkdown)
    } catch (err) {
      console.error('Image paste failed:', err)
    }
  }, [content, onChange])

  // Wiki link click handler
  const handlePreviewClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.classList.contains('wiki-link')) {
      const noteName = target.getAttribute('data-note')
      if (noteName && onWikiLinkClick) {
        e.preventDefault()
        e.stopPropagation()
        onWikiLinkClick(noteName)
      }
    }
  }, [onWikiLinkClick])

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

  if (viewMode === 'edit') {
    // PDF files cannot be edited
    if (isPdf) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-base">
          <div className="text-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-4 text-red">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            <p className="text-text-primary text-lg mb-2">{t('editor.pdfNotEditable')}</p>
            <p className="text-text-muted text-sm">{t('editor.switchToPreview')}</p>
          </div>
        </div>
      )
    }
    return (
      <div className="h-full w-full overflow-hidden">
        <CodeMirrorEditor
          content={content}
          onChange={onChange}
          onPasteImage={handlePasteImage}
        />
      </div>
    )
  }

  if (viewMode === 'preview') {
    // PDF preview mode using PDF.js
    if (isPdf && pdfDataUrl) {
      return <PDFCanvas base64Data={pdfDataUrl} onSendToAI={onSendToAI} onToast={onToast} />
    }

    return (
      <div ref={previewContainerRef as React.RefObject<HTMLDivElement>} className="h-full w-full overflow-y-auto relative" onClick={handlePreviewClick}>
        <div className="p-6 markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
            components={mdComponents}
          >
            {previewContent}
          </ReactMarkdown>
        </div>
        {onSendToAI && <SelectionToolbar containerRef={previewContainerRef as React.RefObject<HTMLElement>} onSendToAI={onSendToAI} />}
      </div>
    )
  }

  // Split view - PDF
  if (isPdf && pdfDataUrl) {
    return <PDFCanvas base64Data={pdfDataUrl} onSendToAI={onSendToAI} onToast={onToast} />
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex overflow-hidden"
      onClick={handlePreviewClick}
      style={{ cursor: isDragging ? 'col-resize' : undefined }}
    >
      <div className="overflow-hidden" style={{ width: `${splitRatio}%`, minWidth: 0 }}>
        <CodeMirrorEditor
          content={content}
          onChange={onChange}
          onPasteImage={handlePasteImage}
        />
      </div>

      <div
        className={`relative shrink-0 w-[5px] cursor-col-resize group transition-colors ${
          isDragging ? 'bg-accent' : 'bg-muted hover:bg-subtle'
        }`}
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 -left-[4px] -right-[4px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-[3px] h-[3px] rounded-full bg-text-secondary" />
          <div className="w-[3px] h-[3px] rounded-full bg-text-secondary" />
          <div className="w-[3px] h-[3px] rounded-full bg-text-secondary" />
        </div>
      </div>

      <div ref={splitContainerRef as React.RefObject<HTMLDivElement>} className="overflow-y-auto overflow-x-hidden flex-1 relative" style={{ minWidth: 0 }}>
        <div className="p-6 markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
            components={mdComponents}
          >
            {previewContent}
          </ReactMarkdown>
        </div>
        {onSendToAI && <SelectionToolbar containerRef={splitContainerRef as React.RefObject<HTMLElement>} onSendToAI={onSendToAI} />}
      </div>
    </div>
  )
}
