import { useState, useEffect } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

interface BacklinksPanelProps {
  noteId: string | null
  onSelectNote: (noteId: string) => void
}

export default function BacklinksPanel({ noteId, onSelectNote }: BacklinksPanelProps) {
  const { t } = useI18n()
  const [backlinks, setBacklinks] = useState<api.BacklinkInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    if (!noteId) {
      setBacklinks([])
      return
    }

    let cancelled = false
    setLoading(true)
    api.getBacklinks(noteId)
      .then(data => {
        if (!cancelled) setBacklinks(data)
      })
      .catch(err => {
        if (!cancelled) console.error('Failed to load backlinks:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [noteId])

  if (!noteId) return null

  return (
    <div className="border-t border-border-muted">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className="text-sm text-text-primary">{t('backlinks.title')}</span>
          {backlinks.length > 0 && (
            <span className="text-xs text-text-muted bg-muted px-1.5 py-0.5 rounded">
              {backlinks.length}
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform text-text-muted ${expanded ? 'rotate-0' : '-rotate-90'}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Content */}
      {expanded && (
        <div className="px-4 pb-3">
          {loading ? (
            <div className="text-xs text-text-muted py-2">Loading...</div>
          ) : backlinks.length === 0 ? (
            <div className="text-xs text-text-muted py-2">{t('backlinks.noBacklinks')}</div>
          ) : (
            <div className="space-y-1">
              {backlinks.map((backlink) => (
                <button
                  key={backlink.noteId}
                  onClick={() => onSelectNote(backlink.noteId)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-muted">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="text-sm text-blue group-hover:text-accent truncate">
                      {backlink.noteTitle}
                    </span>
                  </div>
                  {backlink.context && (
                    <div className="text-xs text-text-muted mt-1 pl-5 line-clamp-2">
                      {backlink.context}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
