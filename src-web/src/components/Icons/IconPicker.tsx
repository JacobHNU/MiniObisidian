import { useState, useMemo, useRef, useEffect } from 'react'
import * as LucideIcons from 'lucide-react'
import { Search, X } from 'lucide-react'

interface IconPickerProps {
  isOpen: boolean
  onSelect: (icon: string) => void
  onClose: () => void
  currentIcon?: string | null
}

// Popular lucide icons organized by category
const ICON_CATEGORIES: Record<string, string[]> = {
  '文件': ['FileText', 'File', 'Folder', 'FolderOpen', 'FolderTree', 'Archive', 'Book', 'BookOpen', 'Library', 'Newspaper'],
  '标记': ['Star', 'Heart', 'Bookmark', 'Flag', 'Tag', 'Tags', 'Award', 'Badge', 'Circle', 'CheckCircle'],
  '工具': ['Settings', 'Wrench', 'Hammer', 'Scissors', 'Paperclip', 'Key', 'Lock', 'Shield', 'Bell', 'Clock'],
  '自然': ['Sun', 'Moon', 'Cloud', 'Zap', 'Flame', 'Droplets', 'Leaf', 'Mountain', 'TreePine', 'Flower2'],
  '箭头': ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ChevronRight', 'ChevronLeft', 'ChevronUp', 'ChevronDown', 'Move', 'Compass'],
  '媒体': ['Image', 'Camera', 'Video', 'Music', 'Mic', 'Volume2', 'Play', 'Pause', 'SkipForward', 'Film'],
  '通讯': ['Mail', 'MessageCircle', 'Phone', 'Send', 'Share', 'Link', 'Globe', 'Wifi', 'Bluetooth', 'Rss'],
  '数据': ['Database', 'Server', 'HardDrive', 'Cpu', 'MemoryStick', 'BarChart', 'PieChart', 'TrendingUp', 'Activity', 'GitBranch'],
  '编辑': ['Edit', 'Edit2', 'Edit3', 'Pen', 'PenLine', 'Type', 'AlignLeft', 'Bold', 'Italic', 'Underline'],
  '界面': ['Home', 'Layout', 'Grid', 'List', 'Maximize', 'Minimize', 'Eye', 'EyeOff', 'Sliders', 'ToggleLeft'],
}

const POPULAR_EMOJI = [
  '📁', '📂', '📝', '📄', '📌', '📎', '🔗', '💡', '🔥', '⭐',
  '❤️', '🎯', '🚀', '💎', '🎨', '🔧', '⚙️', '📊', '📈', '🗂️',
  '📚', '📖', '✏️', '🖊️', '💻', '🖥️', '📱', '🎵', '🎬', '📷',
  '🌿', '🌸', '🌙', '☀️', '🌊', '🏔️', '🦊', '🐱', '🐶', '🦋',
  '✅', '❌', '⚠️', '❓', '❗', '💯', '🏆', '🎁', '🏠', '🌍',
]

export default function IconPicker({ isOpen, onSelect, onClose, currentIcon }: IconPickerProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'lucide' | 'emoji'>('lucide')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) setSearch('')
  }, [isOpen])

  const filteredCategories = useMemo(() => {
    if (!search) return ICON_CATEGORIES
    const q = search.toLowerCase()
    const result: Record<string, string[]> = {}
    for (const [cat, icons] of Object.entries(ICON_CATEGORIES)) {
      const filtered = icons.filter(i => i.toLowerCase().includes(q))
      if (filtered.length > 0) result[cat] = filtered
    }
    return result
  }, [search])

  const filteredEmoji = useMemo(() => {
    if (!search) return POPULAR_EMOJI
    return POPULAR_EMOJI // Emoji search not very useful
  }, [search])

  if (!isOpen) return null

  return (
    <div
      ref={ref}
      className="absolute z-50 top-full left-0 mt-1 w-72 bg-surface border border-border-muted rounded-lg shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('lucide')}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'lucide' ? 'bg-muted text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            图标
          </button>
          <button
            onClick={() => setActiveTab('emoji')}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              activeTab === 'emoji' ? 'bg-muted text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Emoji
          </button>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-muted">
        <div className="flex items-center gap-2 bg-muted rounded px-2 py-1">
          <Search size={14} className="text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索图标..."
            className="flex-1 bg-transparent text-xs text-text-primary outline-none placeholder-text-muted"
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto p-2">
        {activeTab === 'lucide' ? (
          Object.entries(filteredCategories).map(([category, icons]) => (
            <div key={category} className="mb-2">
              <div className="text-xs text-text-muted px-1 mb-1">{category}</div>
              <div className="grid grid-cols-8 gap-0.5">
                {icons.map((name) => {
                  const IconComp = (LucideIcons as Record<string, unknown>)[name] as React.ComponentType<{ size?: number; className?: string }> | undefined
                  if (!IconComp) return null
                  return (
                    <button
                      key={name}
                      onClick={() => { onSelect(name); onClose() }}
                      className={`p-1.5 rounded hover:bg-muted transition-colors flex items-center justify-center ${
                        currentIcon === name ? 'bg-accent/20 text-accent' : 'text-text-secondary'
                      }`}
                      title={name}
                    >
                      <IconComp size={16} />
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="grid grid-cols-10 gap-0.5">
            {filteredEmoji.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onSelect(emoji); onClose() }}
                className={`p-1.5 rounded hover:bg-muted transition-colors text-center ${
                  currentIcon === emoji ? 'bg-accent/20' : ''
                }`}
                style={{ fontSize: 16 }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
