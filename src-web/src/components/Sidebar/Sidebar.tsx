import { useState, useMemo, useRef, useEffect } from 'react'
import type { NoteMeta, FileInfo } from '../../ipc/tauri'
import * as api from '../../ipc/tauri'

interface SidebarProps {
  notes: NoteMeta[]
  folders: string[]
  currentNoteId: string | null
  onSelectNote: (noteId: string) => void
  onCreateNote: () => void
  onCreateNoteInFolder: (folder: string) => void
  onCreateFolder: (folderPath: string) => void
  onCreateDailyNote: () => void
  onDeleteNote: (noteId: string) => void
  onRenameNote: (noteId: string, newTitle: string) => void
  onClose: () => void
  onSwitchVault: () => void
}

interface FolderNode {
  name: string
  path: string
  children: FolderNode[]
  notes: NoteMeta[]
  files?: FileInfo[] // Non-note files (e.g., images in attachments/)
}

interface ContextMenuState {
  x: number
  y: number
  type: 'folder' | 'note'
  folderPath?: string
  noteId?: string
  noteTitle?: string
}

export default function Sidebar({
  notes,
  folders,
  currentNoteId,
  onSelectNote,
  onCreateNote,
  onCreateNoteInFolder,
  onCreateFolder,
  onCreateDailyNote,
  onDeleteNote,
  onRenameNote,
  onClose,
  onSwitchVault,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['inbox', 'daily']))
  const [filter, setFilter] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingSubFolder, setCreatingSubFolder] = useState<string | null>(null)
  const [subFolderName, setSubFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const folderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  useEffect(() => {
    if (renamingNoteId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingNoteId])

  const filteredNotes = useMemo(() => {
    if (!filter) return notes
    const q = filter.toLowerCase()
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)) ||
        n.path.toLowerCase().includes(q)
    )
  }, [notes, filter])

  const { manualNotes, dailyNotes } = useMemo(() => {
    const manual: NoteMeta[] = []
    const daily: NoteMeta[] = []
    for (const note of filteredNotes) {
      if (note.path.startsWith('daily/')) daily.push(note)
      else manual.push(note)
    }
    return { manualNotes: manual, dailyNotes: daily }
  }, [filteredNotes])

  const notebookTree = useMemo(() => {
    const root: FolderNode = { name: '', path: '', children: [], notes: [] }
    const nodeMap = new Map<string, FolderNode>()
    nodeMap.set('', root)
    for (const folder of folders) {
      if (folder.startsWith('daily')) continue
      const parts = folder.split('/')
      let currentPath = ''
      for (const part of parts) {
        const parentPath = currentPath
        currentPath = currentPath ? `${currentPath}/${part}` : part
        if (!nodeMap.has(currentPath)) {
          const node: FolderNode = { name: part, path: currentPath, children: [], notes: [] }
          nodeMap.set(currentPath, node)
          const parent = nodeMap.get(parentPath) || root
          parent.children.push(node)
        }
      }
    }
    for (const note of manualNotes) {
      const folderPath = note.path.substring(0, note.path.lastIndexOf('/'))
      const node = nodeMap.get(folderPath) || root
      node.notes.push(note)
    }
    return root
  }, [folders, manualNotes])

  const dailyTree = useMemo(() => {
    const root: FolderNode = { name: 'daily', path: 'daily', children: [], notes: [] }
    const yearMap = new Map<string, FolderNode>()
    const monthMap = new Map<string, FolderNode>()
    for (const note of dailyNotes) {
      const parts = note.path.replace('daily/', '').split('/')
      let year = '', month = ''
      if (parts.length >= 3) { year = parts[0]; month = parts[1] }
      else {
        const match = parts[parts.length - 1].match(/^(\d{4})-(\d{2})/)
        if (match) { year = match[1]; month = match[2] }
      }
      if (!year) { root.notes.push(note); continue }
      const yearPath = `daily/${year}`
      if (!yearMap.has(yearPath)) {
        const yNode: FolderNode = { name: year, path: yearPath, children: [], notes: [] }
        yearMap.set(yearPath, yNode); root.children.push(yNode)
      }
      const monthPath = `${yearPath}/${month}`
      if (!monthMap.has(monthPath)) {
        const monthNames = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
        const mNode: FolderNode = { name: monthNames[parseInt(month)] || month, path: monthPath, children: [], notes: [] }
        monthMap.set(monthPath, mNode); yearMap.get(yearPath)!.children.push(mNode)
      }
      monthMap.get(monthPath)!.notes.push(note)
    }
    root.children.sort((a, b) => b.name.localeCompare(a.name))
    for (const y of root.children) {
      y.children.sort((a, b) => b.name.localeCompare(a.name))
      for (const m of y.children) m.notes.sort((a, b) => b.path.localeCompare(a.path))
    }
    return root
  }, [dailyNotes])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })
  }

  const handleCreateFolder = () => {
    const name = newFolderName.trim()
    if (name) { onCreateFolder(name); setExpanded((p) => new Set(p).add(name)) }
    setNewFolderName(''); setCreatingFolder(false)
  }

  const handleCreateSubFolder = () => {
    const name = subFolderName.trim()
    if (name && creatingSubFolder) {
      const full = `${creatingSubFolder}/${name}`
      onCreateFolder(full); setExpanded((p) => new Set(p).add(full).add(creatingSubFolder))
    }
    setSubFolderName(''); setCreatingSubFolder(null)
  }

  const startRename = (noteId: string, currentTitle: string) => {
    setRenamingNoteId(noteId)
    setRenameValue(currentTitle || 'Untitled')
    setContextMenu(null)
  }

  const confirmRename = () => {
    if (renamingNoteId && renameValue.trim()) {
      onRenameNote(renamingNoteId, renameValue.trim())
    }
    setRenamingNoteId(null); setRenameValue('')
  }

  // Shared note item renderer with right-click + double-click rename
  const renderNoteItem = (note: NoteMeta, paddingLeft: number) => {
    const isRenaming = renamingNoteId === note.id
    const displayTitle = note.title || note.path.split('/').pop()?.replace('.md', '') || 'Untitled'

    return (
      <div
        key={note.id}
        className={`folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group ${
          currentNoteId === note.id ? 'active bg-[#45475a]' : ''
        }`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={() => !isRenaming && onSelectNote(note.id)}
        onDoubleClick={() => startRename(note.id, displayTitle)}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY, type: 'note', noteId: note.id, noteTitle: displayTitle })
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') { setRenamingNoteId(null); setRenameValue('') }
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-[#313244] text-sm text-[#cdd6f4] outline-none border border-[#cba6f7] rounded px-1 py-0"
          />
        ) : (
          <span className="text-[#cdd6f4] truncate flex-1">{displayTitle}</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteNote(note.id) }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#585b70] text-[#6c7086] hover:text-[#f38ba8] transition-opacity"
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="w-[280px] flex-shrink-0 bg-[#1e1e2e] border-r border-[#313244] flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]">
        <span className="text-sm font-semibold text-[#cba6f7]">Explorer</span>
        <div className="flex gap-1">
          <button onClick={onCreateDailyNote} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#a6e3a1]" title="Today's Daily Note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <button onClick={() => setCreatingFolder(true)} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#f9e2af]" title="New Folder (Notebook)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><path d="M12 11v6M9 14h6" />
            </svg>
          </button>
          <button onClick={onCreateNote} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4]" title="New Note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M12 18v-6M9 15h6" />
            </svg>
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4]" title="Close sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search filter */}
      <div className="px-3 py-2">
        <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter notes..."
          className="w-full px-2.5 py-1.5 text-sm bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] placeholder-[#6c7086] focus:outline-none focus:border-[#cba6f7]" />
      </div>

      {/* Main tree area */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {/* Notebooks Section */}
        <div className="px-2 py-1.5"><span className="text-[10px] font-bold uppercase tracking-wider text-[#6c7086]">Notebooks</span></div>

        {creatingFolder && (
          <div className="flex items-center gap-1.5 px-2 py-1 mx-1 rounded bg-[#313244]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#f9e2af" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
            <input ref={folderInputRef} type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') } }}
              onBlur={handleCreateFolder} placeholder="Folder name..."
              className="flex-1 bg-transparent text-sm text-[#cdd6f4] outline-none placeholder-[#6c7086]" />
          </div>
        )}

        <FolderTree node={notebookTree} expanded={expanded} currentNoteId={currentNoteId} depth={0}
          onToggle={toggleFolder} onSelectNote={onSelectNote} onDeleteNote={onDeleteNote}
          onCreateNoteInFolder={onCreateNoteInFolder}
          onFolderContextMenu={(e, path) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderPath: path }) }}
          creatingSubFolder={creatingSubFolder} subFolderName={subFolderName}
          onSubFolderNameChange={setSubFolderName} onConfirmSubFolder={handleCreateSubFolder}
          onCancelSubFolder={() => { setCreatingSubFolder(null); setSubFolderName('') }}
          renderNoteItem={renderNoteItem} />

        {/* Daily Notes Section */}
        <div className="px-2 py-1.5 mt-3 border-t border-[#313244]"><span className="text-[10px] font-bold uppercase tracking-wider text-[#6c7086]">Daily Notes</span></div>
        <DailyTree tree={dailyTree} expanded={expanded} currentNoteId={currentNoteId}
          onToggle={toggleFolder} onSelectNote={onSelectNote} onDeleteNote={onDeleteNote} renderNoteItem={renderNoteItem} />
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[#313244] flex items-center justify-between">
        <span className="text-xs text-[#6c7086]">{notes.length} notes</span>
        <button
          onClick={onSwitchVault}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#a6adc8] hover:bg-[#313244] hover:text-[#cba6f7] transition-colors"
          title="Switch Vault"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            <path d="M12 11v6M9 14l3 3 3-3" />
          </svg>
          Switch Vault
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-[#313244] border border-[#45475a] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }} onClick={() => setContextMenu(null)}>
          {contextMenu.type === 'folder' && (
            <>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => onCreateNoteInFolder(contextMenu.folderPath!)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M12 18v-6M9 15h6" /></svg>
                New Note
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { setCreatingSubFolder(contextMenu.folderPath!); setContextMenu(null) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><path d="M12 11v6M9 14h6" /></svg>
                New Subfolder
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => {
                  if (contextMenu.folderPath) api.showInFolder(contextMenu.folderPath + '/')
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                Show in Folder
              </button>
            </>
          )}
          {contextMenu.type === 'note' && (
            <>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => startRename(contextMenu.noteId!, contextMenu.noteTitle || '')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                Rename
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => {
                  const note = notes.find(n => n.id === contextMenu.noteId)
                  if (note) api.showInFolder(note.path)
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><path d="M12 11v6M9 14h6" /></svg>
                Show in Folder
              </button>
              <div className="border-t border-[#45475a] my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#f38ba8] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { onDeleteNote(contextMenu.noteId!); setContextMenu(null) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================
   FolderTree
   ============================================ */
interface FolderTreeProps {
  node: FolderNode; expanded: Set<string>; currentNoteId: string | null; depth: number
  onToggle: (path: string) => void; onSelectNote: (noteId: string) => void; onDeleteNote: (noteId: string) => void
  onCreateNoteInFolder: (folder: string) => void
  onFolderContextMenu: (e: React.MouseEvent, folderPath: string) => void
  creatingSubFolder: string | null; subFolderName: string
  onSubFolderNameChange: (name: string) => void; onConfirmSubFolder: () => void; onCancelSubFolder: () => void
  renderNoteItem: (note: NoteMeta, paddingLeft: number) => React.ReactNode
}

function FolderTree({ node, expanded, currentNoteId, depth, onToggle, onCreateNoteInFolder, onFolderContextMenu,
  creatingSubFolder, subFolderName, onSubFolderNameChange, onConfirmSubFolder, onCancelSubFolder, renderNoteItem }: FolderTreeProps) {
  const isExpanded = expanded.has(node.path)
  const [files, setFiles] = useState<FileInfo[]>(node.files || [])
  const [loading, setLoading] = useState(false)

  // Load files when expanding a folder (especially for attachments/)
  useEffect(() => {
    console.log('[Sidebar] FolderTree effect triggered:', { isExpanded, path: node.path, hasFiles: !!node.files })
    if (isExpanded && node.path && !node.files) {
      console.log('[Sidebar] Loading files for folder:', node.path)
      setLoading(true)
      api.listFiles(node.path).then((fileList) => {
        console.log('[Sidebar] Files loaded:', fileList.length, 'files', fileList)
        setFiles(fileList)
        setLoading(false)
      }).catch((err) => {
        console.error('[Sidebar] Failed to load files:', err)
        setLoading(false)
      })
    }
  }, [isExpanded, node.path, node.files])

  return (
    <div>
      {node.path && (
        <div className="folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }} onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onFolderContextMenu(e, node.path)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#f9e2af" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
          <span className="text-[#cdd6f4] truncate flex-1">{node.name}</span>
          <button onClick={(e) => { e.stopPropagation(); onCreateNoteInFolder(node.path) }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#585b70] text-[#6c7086] hover:text-[#cdd6f4] transition-opacity" title="New note here">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
      )}
      {(isExpanded || !node.path) && (
        <div>
          {creatingSubFolder === node.path && (
            <div className="flex items-center gap-1.5 px-2 py-1 mx-1 rounded bg-[#313244]"
              style={{ paddingLeft: `${(node.path ? depth + 1 : depth) * 12 + 24}px` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#f9e2af" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
              <input autoFocus type="text" value={subFolderName} onChange={(e) => onSubFolderNameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onConfirmSubFolder(); if (e.key === 'Escape') onCancelSubFolder() }}
                onBlur={onConfirmSubFolder} placeholder="Subfolder name..."
                className="flex-1 bg-transparent text-sm text-[#cdd6f4] outline-none placeholder-[#6c7086]" />
            </div>
          )}
          {/* Show files in this folder (for attachments/) */}
          {loading && (
            <div className="px-2 py-1 text-xs text-[#6c7086]" style={{ paddingLeft: `${(node.path ? depth + 1 : depth) * 12 + 24}px` }}>
              Loading...
            </div>
          )}
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-[#a6adc8]"
              style={{ paddingLeft: `${(node.path ? depth + 1 : depth) * 12 + 24}px` }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span className="truncate">{file.name}</span>
              <span className="text-xs text-[#6c7086] ml-auto">{(file.size / 1024).toFixed(1)} KB</span>
            </div>
          ))}
          {node.children.map((child) => (
            <FolderTree key={child.path} node={child} expanded={expanded} currentNoteId={currentNoteId}
              depth={node.path ? depth + 1 : depth} onToggle={onToggle} onSelectNote={() => {}} onDeleteNote={() => {}}
              onCreateNoteInFolder={onCreateNoteInFolder} onFolderContextMenu={onFolderContextMenu}
              creatingSubFolder={creatingSubFolder} subFolderName={subFolderName}
              onSubFolderNameChange={onSubFolderNameChange} onConfirmSubFolder={onConfirmSubFolder}
              onCancelSubFolder={onCancelSubFolder} renderNoteItem={renderNoteItem} />
          ))}
          {node.notes.map((note) => renderNoteItem(note, (node.path ? depth + 1 : depth) * 12 + 24))}
        </div>
      )}
    </div>
  )
}

/* ============================================
   DailyTree
   ============================================ */
interface DailyTreeProps {
  tree: FolderNode; expanded: Set<string>; currentNoteId: string | null
  onToggle: (path: string) => void; onSelectNote: (noteId: string) => void; onDeleteNote: (noteId: string) => void
  renderNoteItem: (note: NoteMeta, paddingLeft: number) => React.ReactNode
}

function DailyTree({ tree, expanded, currentNoteId, onToggle, renderNoteItem }: DailyTreeProps) {
  if (tree.children.length === 0 && tree.notes.length === 0) {
    return <div className="px-4 py-3 text-xs text-[#6c7086] text-center">Click the calendar icon to create today's daily note</div>
  }
  return (
    <div>
      {tree.children.map((yearNode) => (
        <div key={yearNode.path}>
          <div className="folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm"
            style={{ paddingLeft: '8px' }} onClick={() => onToggle(yearNode.path)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
              className={`transition-transform ${expanded.has(yearNode.path) ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[#89b4fa] font-medium">{yearNode.name}</span>
          </div>
          {expanded.has(yearNode.path) && yearNode.children.map((monthNode) => (
            <div key={monthNode.path}>
              <div className="folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm"
                style={{ paddingLeft: '24px' }} onClick={() => onToggle(monthNode.path)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
                  className={`transition-transform ${expanded.has(monthNode.path) ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
                <span className="text-[#a6adc8]">{monthNode.name}</span>
                <span className="text-[10px] text-[#6c7086] ml-auto">{monthNode.notes.length}</span>
              </div>
              {expanded.has(monthNode.path) && monthNode.notes.map((note) => renderNoteItem(note, 44))}
            </div>
          ))}
        </div>
      ))}
      {tree.notes.map((note) => renderNoteItem(note, 24))}
    </div>
  )
}
