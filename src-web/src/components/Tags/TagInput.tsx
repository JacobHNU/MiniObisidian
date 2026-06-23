import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import TagBadge from './TagBadge'
import { Plus } from 'lucide-react'

interface TagInputProps {
  noteId: string
  tags: string[]
  onTagsChange: (tags: string[]) => void
  onTagChanged?: () => void
}

export default function TagInput({ noteId, tags, onTagsChange, onTagChanged }: TagInputProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [allTags, setAllTags] = useState<api.Tag[]>([])
  const [suggestions, setSuggestions] = useState<api.Tag[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Load all available tags for autocomplete
  useEffect(() => {
    api.listTags().then(setAllTags).catch(console.error)
  }, [])

  // Filter suggestions based on input
  useEffect(() => {
    if (!inputValue.trim()) {
      setSuggestions([])
      return
    }
    const q = inputValue.toLowerCase()
    const filtered = allTags.filter(
      t => t.name.toLowerCase().includes(q) && !tags.includes(t.name)
    )
    setSuggestions(filtered.slice(0, 8))
  }, [inputValue, allTags, tags])

  useEffect(() => {
    if (isAdding) inputRef.current?.focus()
  }, [isAdding])

  const handleAddTag = useCallback(async (tagName: string) => {
    const trimmed = tagName.trim()
    if (!trimmed || tags.includes(trimmed)) return
    try {
      await api.addTagToNote(noteId, trimmed)
      onTagsChange([...tags, trimmed])
      // Refresh all tags list
      api.listTags().then(setAllTags).catch(console.error)
      // Re-read note content from disk to sync editor
      onTagChanged?.()
    } catch (e) {
      console.error('Failed to add tag:', e)
    }
    setInputValue('')
    setIsAdding(false)
  }, [noteId, tags, onTagsChange, onTagChanged])

  const handleRemoveTag = useCallback(async (tagName: string) => {
    try {
      await api.removeTagFromNote(noteId, tagName)
      onTagsChange(tags.filter(t => t !== tagName))
      // Re-read note content from disk to sync editor
      onTagChanged?.()
    } catch (e) {
      console.error('Failed to remove tag:', e)
    }
  }, [noteId, tags, onTagsChange, onTagChanged])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0) {
        handleAddTag(suggestions[0].name)
      } else if (inputValue.trim()) {
        handleAddTag(inputValue)
      }
    } else if (e.key === 'Escape') {
      setIsAdding(false)
      setInputValue('')
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tags.map(tag => {
        const tagMeta = allTags.find(t => t.name === tag)
        return (
          <TagBadge
            key={tag}
            name={tag}
            color={tagMeta?.color}
            icon={tagMeta?.icon}
            onRemove={() => handleRemoveTag(tag)}
          />
        )
      })}
      {isAdding ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setTimeout(() => {
                setIsAdding(false)
                setInputValue('')
              }, 150)
            }}
            placeholder="输入标签名..."
            className="w-24 text-xs bg-muted border border-border-muted rounded px-1.5 py-0.5 text-text-primary outline-none focus:border-accent"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-surface border border-border-muted rounded shadow-lg z-50 max-h-32 overflow-y-auto">
              {suggestions.map(s => (
                <button
                  key={s.name}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleAddTag(s.name)
                  }}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-text-primary hover:bg-muted transition-colors"
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-0.5 text-xs text-text-muted hover:text-text-primary transition-colors px-1 py-0.5 rounded hover:bg-muted"
        >
          <Plus size={12} />
          <span>标签</span>
        </button>
      )}
    </div>
  )
}
