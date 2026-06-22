import { useState, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

interface SearchPanelProps {
  onSelectNote: (noteId: string) => void
}

export default function SearchPanel({ onSelectNote }: SearchPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<api.SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      return
    }

    setSearching(true)
    try {
      const searchResults = await api.searchNotes(query.trim(), 50)
      setResults(searchResults)
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search input */}
      <div className="p-4 border-b border-border-muted">
        <div className="flex gap-2 max-w-[600px] mx-auto">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.placeholder')}
            className="flex-1 px-4 py-2 bg-muted border border-border-hover rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-accent text-text-inverse font-medium rounded-lg hover:bg-lavender transition-colors"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[600px] mx-auto space-y-2">
          {results.length === 0 && query && !searching && (
            <p className="text-center text-text-muted py-8">
              No results found for "{query}"
            </p>
          )}

          {results.map((result) => (
            <div
              key={result.noteId}
              className="p-3 rounded-lg bg-muted hover:bg-hover cursor-pointer transition-colors"
              onClick={() => onSelectNote(result.noteId)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-text-primary">
                  {result.title}
                </span>
                <span className="text-xs text-text-muted">
                  {t('search.score', { score: result.score.toFixed(2) })}
                </span>
              </div>
              <div className="text-sm text-text-secondary mt-1">{result.path}</div>
              {result.snippet && (
                <div className="text-xs text-text-muted mt-1.5 line-clamp-2">
                  {result.snippet}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
