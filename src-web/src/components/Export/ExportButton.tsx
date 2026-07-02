import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../../i18n'
import { exportToPdf, exportToDoc, exportToDocx, markdownToHtml } from '../../utils/export'

type ExportFormat = 'pdf' | 'doc' | 'docx'

interface ExportButtonProps {
  /** The raw markdown content */
  content: string
  /** Note title for file naming */
  title: string
  /** The rendered preview HTML element (for PDF export) */
  previewRef?: React.RefObject<HTMLElement>
}

export default function ExportButton({ content, title, previewRef }: ExportButtonProps) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleExport = async (format: ExportFormat) => {
    setIsOpen(false)
    setExporting(true)
    setStatusMsg('')

    try {
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_') || 'untitled'

      if (format === 'pdf') {
        // Use rendered HTML for PDF
        const previewEl = previewRef?.current
        if (previewEl) {
          await exportToPdf(previewEl, safeTitle, setStatusMsg)
        } else {
          // Fallback: create a temporary element with rendered markdown
          const html = markdownToHtml(content)
          const tempDiv = document.createElement('div')
          tempDiv.innerHTML = html
          tempDiv.style.cssText = 'font-family: Segoe UI, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; max-width: 800px; padding: 20px;'
          document.body.appendChild(tempDiv)
          try {
            await exportToPdf(tempDiv, safeTitle, setStatusMsg)
          } finally {
            document.body.removeChild(tempDiv)
          }
        }
      } else {
        // DOC and DOCX use markdown-to-HTML conversion
        const html = markdownToHtml(content)
        if (format === 'doc') {
          await exportToDoc(html, safeTitle, setStatusMsg)
        } else {
          await exportToDocx(html, safeTitle, setStatusMsg)
        }
      }
    } catch (err) {
      console.error('Export failed:', err)
      setStatusMsg(`Export failed: ${err}`)
    } finally {
      setExporting(false)
      setTimeout(() => setStatusMsg(''), 3000)
    }
  }

  const formats: { key: ExportFormat; label: string; icon: JSX.Element }[] = [
    {
      key: 'pdf',
      label: 'PDF',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      key: 'doc',
      label: 'DOC',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      ),
    },
    {
      key: 'docx',
      label: 'DOCX',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M10 12l-2 6-2-6" />
          <path d="M16 12l2 6 2-6" />
        </svg>
      ),
    },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={exporting}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-surface border border-border-muted text-text-secondary hover:text-text-primary hover:bg-hover transition-colors disabled:opacity-50"
        title={t('editor.export')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7,10 12,15 17,10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {exporting ? statusMsg || '...' : t('editor.export')}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border-muted rounded-lg shadow-lg py-1 min-w-[120px]">
          {formats.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => handleExport(key)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Status toast */}
      {statusMsg && !exporting && (
        <div className="absolute right-0 top-full mt-1 z-50 px-3 py-1.5 text-xs bg-accent text-text-inverse rounded shadow-md whitespace-nowrap">
          {statusMsg}
        </div>
      )}
    </div>
  )
}
