import { useState, useEffect, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import TagBadge from './TagBadge'
import IconPicker from '../Icons/IconPicker'
import IconRenderer from '../Icons/IconRenderer'
import { Plus, Trash2, Edit2, X, ChevronRight } from 'lucide-react'

interface TagPanelProps {
  onSelectNote: (noteId: string) => void
}

const PRESET_COLORS = [
  '#cba6f7', '#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af',
  '#fab387', '#f5c2e7', '#94e2d5', '#b4befe', '#89dceb',
  '#eba0ac', '#74c7ec', '#f2cdcd', '#a6e3a1', '#89dceb',
]

export default function TagPanel({ onSelectNote }: TagPanelProps) {
  const [tags, setTags] = useState<api.Tag[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [tagNotes, setTagNotes] = useState<api.NoteMeta[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [newTagIcon, setNewTagIcon] = useState<string | null>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ tag: api.Tag; x: number; y: number } | null>(null)

  const refreshTags = useCallback(async () => {
    try {
      const result = await api.listTags()
      setTags(result)
    } catch (e) {
      console.error('Failed to load tags:', e)
    }
  }, [])

  useEffect(() => { refreshTags() }, [refreshTags])

  // Load notes for selected tag
  useEffect(() => {
    if (!selectedTag) {
      setTagNotes([])
      return
    }
    api.getNotesByTag(selectedTag).then(setTagNotes).catch(console.error)
  }, [selectedTag])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handle = () => setContextMenu(null)
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [contextMenu])

  const handleCreateTag = async () => {
    const name = newTagName.trim()
    if (!name || tags.some(t => t.name === name)) return
    try {
      await api.createTag(name, newTagColor, newTagIcon || undefined)
      setNewTagName('')
      setNewTagColor(PRESET_COLORS[0])
      setNewTagIcon(null)
      setIsCreating(false)
      await refreshTags()
    } catch (e) {
      console.error('Failed to create tag:', e)
    }
  }

  const handleDeleteTag = async (name: string) => {
    try {
      await api.deleteTag(name)
      if (selectedTag === name) setSelectedTag(null)
      await refreshTags()
    } catch (e) {
      console.error('Failed to delete tag:', e)
    }
  }

  const handleUpdateTag = async (name: string, color?: string, icon?: string) => {
    try {
      await api.updateTag(name, color, icon)
      setEditingTag(null)
      await refreshTags()
    } catch (e) {
      console.error('Failed to update tag:', e)
    }
  }

  // Count notes per tag (approximate from all notes)
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    api.listNotes().then(notes => {
      const counts: Record<string, number> = {}
      for (const note of notes) {
        for (const tag of note.tags) {
          counts[tag] = (counts[tag] || 0) + 1
        }
      }
      setNoteCounts(counts)
    }).catch(console.error)
  }, [tags])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">标签</span>
        <button
          onClick={() => setIsCreating(true)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-muted transition-colors"
          title="新建标签"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Create tag form */}
      {isCreating && (
        <div className="px-3 pb-2 space-y-2">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
            placeholder="标签名称"
            className="w-full text-xs bg-muted border border-border-muted rounded px-2 py-1 text-text-primary outline-none focus:border-accent"
            autoFocus
          />
          {/* Color picker */}
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewTagColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-colors ${
                  newTagColor === c ? 'border-text-primary' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {/* Icon picker trigger */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setIconPickerOpen(!iconPickerOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-hover transition-colors text-text-secondary"
              >
                <IconRenderer icon={newTagIcon} size={14} />
                <span>{newTagIcon || '选择图标'}</span>
              </button>
              <IconPicker
                isOpen={iconPickerOpen}
                onSelect={(icon) => { setNewTagIcon(icon); setIconPickerOpen(false) }}
                onClose={() => setIconPickerOpen(false)}
                currentIcon={newTagIcon}
              />
            </div>
            {newTagIcon && (
              <button onClick={() => setNewTagIcon(null)} className="text-text-muted hover:text-text-primary">
                <X size={12} />
              </button>
            )}
          </div>
          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCreateTag}
              disabled={!newTagName.trim()}
              className="flex-1 px-2 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-lavender transition-colors disabled:opacity-50"
            >
              创建
            </button>
            <button
              onClick={() => { setIsCreating(false); setNewTagName(''); setNewTagIcon(null) }}
              className="px-2 py-1 text-xs bg-muted text-text-secondary rounded hover:bg-hover transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Tag list */}
      <div className="flex-1 overflow-y-auto px-1">
        {tags.length === 0 && !isCreating && (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <p className="text-xs">暂无标签</p>
            <button
              onClick={() => setIsCreating(true)}
              className="mt-2 text-xs text-accent hover:underline"
            >
              创建第一个标签
            </button>
          </div>
        )}
        {tags.map(tag => (
          <div key={tag.name}>
            <div
              className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                selectedTag === tag.name ? 'bg-muted' : 'hover:bg-muted/50'
              }`}
              onClick={() => setSelectedTag(selectedTag === tag.name ? null : tag.name)}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ tag, x: e.clientX, y: e.clientY })
              }}
            >
              <IconRenderer icon={tag.icon} size={14} className="text-text-secondary" />
              <span className="flex-1 text-xs text-text-primary truncate">{tag.name}</span>
              <span className="text-xs text-text-muted">{noteCounts[tag.name] || 0}</span>
              <ChevronRight
                size={12}
                className={`text-text-muted transition-transform ${selectedTag === tag.name ? 'rotate-90' : ''}`}
              />
            </div>

            {/* Expanded notes list */}
            {selectedTag === tag.name && (
              <div className="ml-4 border-l border-border-muted">
                {tagNotes.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-text-muted">无关联笔记</div>
                ) : (
                  tagNotes.map(note => (
                    <button
                      key={note.id}
                      onClick={() => onSelectNote(note.id)}
                      className="flex items-center gap-1.5 w-full px-3 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-muted/50 transition-colors text-left"
                    >
                      <span className="truncate">{note.title || note.path}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-surface border border-border-muted rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setEditingTag(contextMenu.tag.name)
              setNewTagColor(contextMenu.tag.color)
              setNewTagIcon(contextMenu.tag.icon)
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-muted transition-colors"
          >
            <Edit2 size={12} />
            编辑
          </button>
          <button
            onClick={() => {
              handleDeleteTag(contextMenu.tag.name)
              setContextMenu(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red hover:bg-muted transition-colors"
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      )}

      {/* Edit tag dialog (inline) */}
      {editingTag && (
        <div className="px-3 pb-2 space-y-2 border-t border-border-muted pt-2">
          <div className="text-xs text-text-secondary">编辑标签: {editingTag}</div>
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewTagColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-colors ${
                  newTagColor === c ? 'border-text-primary' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setIconPickerOpen(!iconPickerOpen)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-muted rounded hover:bg-hover transition-colors text-text-secondary"
              >
                <IconRenderer icon={newTagIcon} size={14} />
                <span>{newTagIcon || '选择图标'}</span>
              </button>
              <IconPicker
                isOpen={iconPickerOpen}
                onSelect={(icon) => { setNewTagIcon(icon); setIconPickerOpen(false) }}
                onClose={() => setIconPickerOpen(false)}
                currentIcon={newTagIcon}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleUpdateTag(editingTag, newTagColor, newTagIcon || undefined)}
              className="flex-1 px-2 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-lavender transition-colors"
            >
              保存
            </button>
            <button
              onClick={() => { setEditingTag(null); setNewTagIcon(null) }}
              className="px-2 py-1 text-xs bg-muted text-text-secondary rounded hover:bg-hover transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
