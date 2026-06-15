import { useState, useCallback } from 'react'
import * as api from '../../ipc/tauri'

interface SearchPanelProps {
  onSelectNote: (noteId: string) => void
}

export default function SearchPanel({ onSelectNote }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<api.NoteMeta[]>([])
  const [searching, setSearching] = useState(false)

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([])
      return
    }

    setSearching(true)
    try {
      // For now, filter from the full note list
      // Later this will use Tantivy search via IPC
      const allNotes = await api.listNotes()
      const q = query.toLowerCase()
      const filtered = allNotes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)) ||
          n.path.toLowerCase().includes(q)
      )
      setResults(filtered)
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
      <div className="p-4 border-b border-[#313244]">
        <div className="flex gap-2 max-w-[600px] mx-auto">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes by title, tag, or content..."
            className="flex-1 px-4 py-2 bg-[#313244] border border-[#45475a] rounded-lg text-[#cdd6f4] placeholder-[#6c7086] focus:outline-none focus:border-[#cba6f7]"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-[#cba6f7] text-[#1e1e2e] font-medium rounded-lg hover:bg-[#b4befe] transition-colors"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[600px] mx-auto space-y-2">
          {results.length === 0 && query && !searching && (
            <p className="text-center text-[#6c7086] py-8">
              No results found for "{query}"
            </p>
          )}

          {results.map((note) => (
            <div
              key={note.id}
              className="p-3 rounded-lg bg-[#313244] hover:bg-[#45475a] cursor-pointer transition-colors"
              onClick={() => onSelectNote(note.id)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#cdd6f4]">
                  {note.title}
                </span>
                <span className="text-xs text-[#6c7086]">
                  {new Date(note.updated_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
              <div className="text-sm text-[#a6adc8] mt-1">{note.path}</div>
              {note.tags.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 text-xs bg-[#1e1e2e] text-[#cba6f7] rounded"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
