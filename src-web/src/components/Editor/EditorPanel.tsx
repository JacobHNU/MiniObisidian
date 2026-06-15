import { useCallback, useRef, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import * as api from '../../ipc/tauri'

interface EditorPanelProps {
  content: string
  onChange: (content: string) => void
  viewMode: 'edit' | 'preview' | 'split'
  currentNoteId?: string | null
}

export default function EditorPanel({ content, onChange, viewMode, currentNoteId }: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [isDragging, setIsDragging] = useState(false)

  // Handle tab key and image paste
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    },
    [content, onChange]
  )

  // Handle image paste
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          try {
            // Generate a filename
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

            // Build the markdown image tag
            let imgMarkdown = ''
            try {
              const relPath = await api.saveAttachment(filename, base64)
              imgMarkdown = `![${filename}](${relPath})`
            } catch (fsErr) {
              console.warn('saveAttachment failed, using data URI:', fsErr)
              const dataUri = `data:${file.type};base64,${base64}`
              imgMarkdown = `![${filename}](${dataUri})`
            }

            // Insert using direct DOM access to avoid stale closure
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
    },
    [content, onChange]
  )

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
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('wiki-link')) {
        const noteName = target.getAttribute('data-note')
        if (noteName) console.log('Navigate to note:', noteName)
      }
    },
    []
  )

  const processedContent = useMemo(() => {
    return content.replace(
      /\[\[([^\]]+)\]\]/g,
      '<span class="wiki-link" data-note="$1">$1</span>'
    )
  }, [content])

  const previewContent = useMemo(() => {
    const match = processedContent.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
    return match ? match[1].trim() : processedContent
  }, [processedContent])

  // Drag-to-resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

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
      className={`w-full bg-transparent text-[#cdd6f4] resize-none focus:outline-none font-mono text-[15px] leading-relaxed ${extraClass || ''}`}
      style={{ minHeight: 'calc(100vh - 120px)' }}
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
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
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
      className="h-full w-full flex"
      onClick={handlePreviewClick}
      style={{ cursor: isDragging ? 'col-resize' : undefined }}
    >
      <div className="overflow-y-auto shrink-0" style={{ width: `${splitRatio}%` }}>
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

      <div className="overflow-y-auto shrink-0" style={{ width: `${100 - splitRatio}%` }}>
        <div className="p-6 markdown-preview">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
            {previewContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
