import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type { NoteMeta, FileInfo } from '../../ipc/tauri'
import * as api from '../../ipc/tauri'
import ConfirmDialog from '../ConfirmDialog'

interface SidebarProps {
  notes: NoteMeta[]
  folders: string[]
  currentNoteId: string | null
  onSelectNote: (noteId: string) => void
  onOpenPdf: (dataUri: string, fileName: string, noteId: string) => void
  onCreateNote: () => void
  onCreateNoteInFolder: (folder: string) => void
  onCreateFolder: (folderPath: string) => void
  onDeleteFolder: (folderPath: string) => void
  onCreateDailyNote: (date?: string) => void
  onDeleteNote: (noteId: string) => void
  onRenameNote: (noteId: string, newTitle: string) => void
  onMoveNote: (noteId: string, destPath: string) => void
  onClose: () => void
  onSwitchVault: () => void
}

interface FolderNode {
  name: string
  path: string
  children: FolderNode[]
  notes: NoteMeta[]
  files?: FileInfo[]
}

interface ContextMenuState {
  x: number
  y: number
  type: 'folder' | 'note' | 'daily' | 'daily-year' | 'daily-month' | 'section'
  folderPath?: string
  noteId?: string
  noteTitle?: string
  year?: string
  month?: string
}

export default function Sidebar({
  notes,
  folders,
  currentNoteId,
  onSelectNote,
  onOpenPdf,
  onCreateNote,
  onCreateNoteInFolder,
  onCreateFolder,
  onDeleteFolder,
  onCreateDailyNote,
  onDeleteNote,
  onRenameNote,
  onMoveNote,
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
  const renamingNoteIdRef = useRef<string | null>(null)
  const renameValueRef = useRef('')
  const localTitlesRef = useRef<Map<string, string>>(new Map())
  const folderInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} })

  // Drag and drop state
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    draggedNoteId: string | null
    draggedNotePath: string | null
    dropTargetPath: string | null
    dropTargetName: string | null
  }>({
    isDragging: false,
    draggedNoteId: null,
    draggedNotePath: null,
    dropTargetPath: null,
    dropTargetName: null
  })
  const dragStateRef = useRef(dragState)
  useEffect(() => { dragStateRef.current = dragState }, [dragState])

  // Click timer refs for distinguishing single/double click on notes
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDoubleClickRef = useRef(false)

  useEffect(() => {
    const handler = () => {
      setContextMenu(null)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  useEffect(() => {
    if (renamingNoteId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingNoteId])

  // Clear optimistic local titles when notes prop updates from backend
  useEffect(() => {
    if (localTitlesRef.current.size > 0) {
      // Check if backend titles match local optimistic titles
      for (const [id, localTitle] of localTitlesRef.current) {
        const note = notes.find(n => n.id === id)
        if (note && note.title === localTitle) {
          localTitlesRef.current.delete(id)
        }
      }
    }
  }, [notes])

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
      
      if (parts.length >= 3) {
        year = parts[0]
        month = parts[1]
      } else {
        const fileName = parts[parts.length - 1]
        const match = fileName.match(/^(\d{4})-(\d{2})/)
        if (match) {
          year = match[1]
          month = match[2]
        }
      }
      
      if (!year || !month || year.length !== 4) {
        root.notes.push(note)
        continue
      }
      
      const yearPath = `daily/${year}`
      if (!yearMap.has(yearPath)) {
        const yNode: FolderNode = { name: year, path: yearPath, children: [], notes: [] }
        yearMap.set(yearPath, yNode)
        root.children.push(yNode)
      }
      
      const monthPath = `${yearPath}/${month}`
      if (!monthMap.has(monthPath)) {
        const monthNames = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
        const mNode: FolderNode = { name: monthNames[parseInt(month)] || month, path: monthPath, children: [], notes: [] }
        monthMap.set(monthPath, mNode)
        yearMap.get(yearPath)!.children.push(mNode)
      }
      
      monthMap.get(monthPath)!.notes.push(note)
    }
    
    root.children.sort((a, b) => b.name.localeCompare(a.name))
    for (const y of root.children) {
      y.children.sort((a, b) => b.name.localeCompare(a.name))
      for (const m of y.children) {
        m.notes.sort((a, b) => b.path.localeCompare(a.path))
      }
    }
    
    return root
  }, [dailyNotes])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n })
  }

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, noteId: string, notePath: string) => {
    e.dataTransfer.setData('text/plain', noteId)
    e.dataTransfer.effectAllowed = 'move'
    const newState = {
      isDragging: true,
      draggedNoteId: noteId,
      draggedNotePath: notePath,
      dropTargetPath: null as string | null,
      dropTargetName: null as string | null
    }
    dragStateRef.current = newState // Sync ref immediately for event handlers
    setDragState(newState)
  }, [])

  const handleDragEnd = useCallback(() => {
    const resetState = {
      isDragging: false,
      draggedNoteId: null,
      draggedNotePath: null,
      dropTargetPath: null,
      dropTargetName: null
    }
    dragStateRef.current = resetState
    setDragState(resetState)
  }, [])

  // Called when dragging over a specific folder node — sets that folder as drop target
  const handleFolderDragOver = useCallback((e: React.DragEvent, folderPath: string, folderName: string) => {
    e.preventDefault()
    e.stopPropagation() // Prevent bubbling to container (root drop target)
    e.dataTransfer.dropEffect = 'move'
    setDragState(prev => {
      if (prev.dropTargetPath === folderPath) return prev // No state change needed
      return { ...prev, dropTargetPath: folderPath, dropTargetName: folderName }
    })
  }, [])

  // Called when dragging over the sidebar scrollable container (but not over a folder) — root drop target
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault() // Always prevent default to allow drop, must be before guard
    if (!dragStateRef.current.isDragging) return // Only update state during active drag
    e.dataTransfer.dropEffect = 'move'
    setDragState(prev => {
      if (prev.dropTargetPath === '') return prev
      return { ...prev, dropTargetPath: '', dropTargetName: '' }
    })
  }, [])

  // Called when drag enters the container — ensure default is prevented
  const handleContainerDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault() // Required by HTML5 DnD spec
  }, [])

  // Unified drop handler — works for both folders and root
  const handleDrop = useCallback((e: React.DragEvent, destPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!dragStateRef.current.isDragging) return // Only respond during active drag
    const noteId = e.dataTransfer.getData('text/plain')
    if (noteId) {
      onMoveNote(noteId, destPath)
    }
    handleDragEnd()
  }, [onMoveNote, handleDragEnd])

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
    // Save any pending rename before switching
    const pendingId = renamingNoteIdRef.current
    const pendingValue = renameValueRef.current
    if (pendingId && pendingValue.trim() && pendingId !== noteId) {
      onRenameNote(pendingId, pendingValue.trim())
    }
    renamingNoteIdRef.current = noteId
    renameValueRef.current = currentTitle || 'Untitled'
    setRenamingNoteId(noteId)
    setRenameValue(currentTitle || 'Untitled')
    setContextMenu(null)
  }

  const confirmRename = () => {
    const currentId = renamingNoteIdRef.current
    const currentValue = renameValueRef.current
    if (currentId && currentValue.trim()) {
      const trimmed = currentValue.trim()
      // Optimistic update: store the new title locally so it displays immediately
      localTitlesRef.current.set(currentId, trimmed)
      onRenameNote(currentId, trimmed)
    }
    renamingNoteIdRef.current = null
    renameValueRef.current = ''
    setRenamingNoteId(null)
    setRenameValue('')
  }

  const renderNoteItem = (note: NoteMeta, paddingLeft: number) => {
    const isRenaming = renamingNoteId === note.id
    const localTitle = localTitlesRef.current.get(note.id)
    const displayTitle = localTitle || note.title || note.path.split('/').pop()?.replace(/\.(md|pdf)$/i, '') || 'Untitled'
    const isDragging = dragState.draggedNoteId === note.id
    const isPdf = note.path.toLowerCase().endsWith('.pdf')

    const handleSingleClick = async () => {
      if (isRenaming) return
      if (isPdf) {
        try {
          const base64Data = await api.readFileBase64(note.path)
          if (!base64Data) {
            alert('无法打开PDF文件: 返回数据为空')
            return
          }
          onOpenPdf(base64Data, displayTitle, note.id)
        } catch (e) {
          console.error('[PDF] Failed to open PDF:', e)
          alert('无法打开PDF文件: ' + String(e))
        }
      } else {
        onSelectNote(note.id)
      }
    }

    const handleClick = () => {
      if (isRenaming) return
      // Clear any pending single click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      // Mark that we're not in a double-click yet
      isDoubleClickRef.current = false
      // Delay single click to allow double-click to cancel it
      clickTimerRef.current = setTimeout(() => {
        if (!isDoubleClickRef.current) {
          handleSingleClick()
        }
        clickTimerRef.current = null
      }, 200)
    }

    const handleDoubleClick = () => {
      // Cancel pending single click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      isDoubleClickRef.current = true
      if (!isPdf) {
        startRename(note.id, displayTitle)
      }
    }

    return (
      <div
        key={note.id}
        data-custom-context-menu="true"
        draggable={!isRenaming}
        className={`folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group ${
          currentNoteId === note.id ? 'active bg-[#45475a]' : ''
        } ${isDragging ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY, type: 'note', noteId: note.id, noteTitle: displayTitle })
        }}
        onDragStart={(e) => handleDragStart(e, note.id, note.path)}
        onDragEnd={handleDragEnd}
        onDragEnter={(e) => e.preventDefault()}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      >
        {isPdf ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f38ba8" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <path d="M9 15l2 2 4-4" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => { setRenameValue(e.target.value); renameValueRef.current = e.target.value }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') { renamingNoteIdRef.current = null; renameValueRef.current = ''; setRenamingNoteId(null); setRenameValue('') }
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-[#313244] text-sm text-[#cdd6f4] outline-none border border-[#cba6f7] rounded px-1 py-0"
          />
        ) : (
          <span className="text-[#cdd6f4] truncate flex-1">{displayTitle}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDialog({
              isOpen: true,
              title: '删除笔记',
              message: `确定要删除「${displayTitle}」吗？该笔记将移入回收站，可在 .vault/trash 中找回。`,
              onConfirm: () => { onDeleteNote(note.id); setConfirmDialog(prev => ({ ...prev, isOpen: false })) },
            })
          }}
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]">
        <span className="text-sm font-semibold text-[#cba6f7]">Explorer</span>
        <div className="flex gap-1">
          <button onClick={() => onCreateDailyNote()} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#a6e3a1]" title="Today's Daily Note">
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

      <div className="px-3 py-2">
        <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter notes..."
          className="w-full px-2.5 py-1.5 text-sm bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] placeholder-[#6c7086] focus:outline-none focus:border-[#cba6f7]" />
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1"
        onDragEnter={handleContainerDragEnter}
        onDragOver={handleContainerDragOver}
        onDrop={(e) => handleDrop(e, '')}
      >
        <div className="px-2 py-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#6c7086]">Notebooks</span>
          {dragState.isDragging && (dragState.dropTargetPath === null || dragState.dropTargetPath === '') && (
            <span className="text-[10px] text-[#89b4fa] animate-pulse">放置到根目录</span>
          )}
        </div>

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
          renderNoteItem={renderNoteItem}
          onDragOver={handleFolderDragOver} onDrop={handleDrop}
          dropTargetPath={dragState.dropTargetPath} />

        <div className="px-2 py-1.5 mt-3 border-t border-[#313244]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#6c7086]">Daily Notes</span>
        </div>
        
        <DailyTree tree={dailyTree} expanded={expanded} currentNoteId={currentNoteId}
          onToggle={toggleFolder} onSelectNote={onSelectNote} onDeleteNote={onDeleteNote} renderNoteItem={renderNoteItem}
          onCreateDailyNote={onCreateDailyNote}
          onDailyContextMenu={(e, type, noteId?, year?, month?) => {
            e.preventDefault(); e.stopPropagation()
            setContextMenu({ x: e.clientX, y: e.clientY, type, noteId, year, month })
          }} />
      </div>

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

      {contextMenu && (
        <div className="fixed z-50 bg-[#313244] border border-[#45475a] rounded-lg shadow-xl py-1 min-w-[180px]"
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
              <div className="border-t border-[#45475a] my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#f38ba8] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => {
                  if (contextMenu.folderPath) {
                    setConfirmDialog({
                      isOpen: true,
                      title: '删除文件夹',
                      message: `确定要删除「${contextMenu.folderPath}」文件夹及其所有笔记吗？文件夹内的笔记将移入回收站，可在 .vault/trash 中找回。`,
                      onConfirm: () => { onDeleteFolder(contextMenu.folderPath!); setConfirmDialog(prev => ({ ...prev, isOpen: false })) },
                    })
                  }
                  setContextMenu(null)
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                Delete Folder
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
                onClick={() => {
                  const noteTitle = contextMenu.noteTitle || '此笔记'
                  setConfirmDialog({
                    isOpen: true,
                    title: '删除笔记',
                    message: `确定要删除「${noteTitle}」吗？该笔记将移入回收站，可在 .vault/trash 中找回。`,
                    onConfirm: () => { onDeleteNote(contextMenu.noteId!); setConfirmDialog(prev => ({ ...prev, isOpen: false })) },
                  })
                  setContextMenu(null)
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                Delete
              </button>
            </>
          )}
          {contextMenu.type === 'daily' && (
            <>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { onCreateDailyNote(); setContextMenu(null) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Today's Note
              </button>

              {contextMenu.noteId && (
                <>
                  <div className="border-t border-[#45475a] my-1" />
                  <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                    onClick={() => {
                      const note = notes.find(n => n.id === contextMenu.noteId);
                      if (note) api.showInFolder(note.path);
                      setContextMenu(null);
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /><path d="M12 11v6M9 14h6" /></svg>
                    Show in Folder
                  </button>
                  <button className="w-full text-left px-3 py-1.5 text-sm text-[#f38ba8] hover:bg-[#45475a] flex items-center gap-2"
                    onClick={() => {
                      const noteTitle = contextMenu.noteTitle || notes.find(n => n.id === contextMenu.noteId)?.title || '此笔记'
                      setConfirmDialog({
                        isOpen: true,
                        title: '删除笔记',
                        message: `确定要删除「${noteTitle}」吗？该笔记将移入回收站，可在 .vault/trash 中找回。`,
                        onConfirm: () => { onDeleteNote(contextMenu.noteId!); setConfirmDialog(prev => ({ ...prev, isOpen: false })) },
                      })
                      setContextMenu(null)
                    }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                    Delete This Note
                  </button>
                </>
              )}
            </>
          )}
          {contextMenu.type === 'daily-year' && (
            <>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { onCreateDailyNote(); setContextMenu(null) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Today's Note
              </button>
              <div className="border-t border-[#45475a] my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { 
                  if (contextMenu.year && contextMenu.year !== 'daily') {
                    const folderPath = `daily/${contextMenu.year}`
                    // Just show in folder, don't create anything
                    api.showInFolder(folderPath)
                  }
                  setContextMenu(null) 
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                Show in Folder
              </button>
            </>
          )}
          {contextMenu.type === 'daily-month' && (
            <>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { onCreateDailyNote(); setContextMenu(null) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Today's Note
              </button>
              <div className="border-t border-[#45475a] my-1" />
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { 
                  if (contextMenu.year && contextMenu.month) {
                    const folderPath = `daily/${contextMenu.year}/${contextMenu.month}`
                    // Just show in folder, don't create anything
                    api.showInFolder(folderPath)
                  }
                  setContextMenu(null) 
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                Show in Folder
              </button>
              <button className="w-full text-left px-3 py-1.5 text-sm text-[#f38ba8] hover:bg-[#45475a] flex items-center gap-2"
                onClick={() => { 
                  if (contextMenu.year && contextMenu.month) {
                    const folderPath = `daily/${contextMenu.year}/${contextMenu.month}`
                    setConfirmDialog({
                      isOpen: true,
                      title: '删除月份文件夹',
                      message: `确定要删除「${contextMenu.year}年${contextMenu.month}月」文件夹及其所有笔记吗？文件夹内的笔记将移入回收站，可在 .vault/trash 中找回。`,
                      onConfirm: () => { onDeleteFolder(folderPath); setConfirmDialog(prev => ({ ...prev, isOpen: false })) },
                    })
                  }
                  setContextMenu(null) 
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                Delete Month (and notes)
              </button>
            </>
          )}
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}

interface FolderTreeProps {
  node: FolderNode; expanded: Set<string>; currentNoteId: string | null; depth: number
  onToggle: (path: string) => void; onSelectNote: (noteId: string) => void; onDeleteNote: (noteId: string) => void
  onCreateNoteInFolder: (folder: string) => void
  onFolderContextMenu: (e: React.MouseEvent, folderPath: string) => void
  creatingSubFolder: string | null; subFolderName: string
  onSubFolderNameChange: (name: string) => void; onConfirmSubFolder: () => void; onCancelSubFolder: () => void
  renderNoteItem: (note: NoteMeta, paddingLeft: number) => React.ReactNode
  onDragOver?: (e: React.DragEvent, folderPath: string, folderName: string) => void
  onDrop?: (e: React.DragEvent, destPath: string) => void
  dropTargetPath?: string | null
}

function FolderTree({ node, expanded, currentNoteId, depth, onToggle, onSelectNote, onDeleteNote, onCreateNoteInFolder, onFolderContextMenu,
  creatingSubFolder, subFolderName, onSubFolderNameChange, onConfirmSubFolder, onCancelSubFolder, renderNoteItem,
  onDragOver, onDrop, dropTargetPath }: FolderTreeProps) {
  const isExpanded = expanded.has(node.path)
  const isDropTarget = dropTargetPath === node.path
  const [files, setFiles] = useState<FileInfo[]>(node.files || [])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isExpanded && node.path && !node.files) {
      setLoading(true)
      api.listFiles(node.path).then((fileList) => {
        setFiles(fileList)
        setLoading(false)
      }).catch(() => setLoading(false))
    }
  }, [isExpanded, node.path, node.files])

  return (
    <div>
      {node.path && (
        <div data-custom-context-menu="true"
          className={`folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group transition-all ${
            isDropTarget ? 'bg-[#89b4fa]/20 border border-[#89b4fa] scale-[1.02]' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onFolderContextMenu(e, node.path)}
          onDragEnter={(e) => e.preventDefault()}
          onDragOver={onDragOver ? (e) => onDragOver(e, node.path, node.name) : (e) => e.preventDefault()}
          onDrop={onDrop ? (e) => onDrop(e, node.path) : undefined}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
            className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={isDropTarget ? '#89b4fa' : '#f9e2af'} stroke="none">
            <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            {isDropTarget && <path d="M12 8v6m-3-3h6" stroke="#1e1e2e" strokeWidth="2" fill="none" />}
          </svg>
          <span className={`truncate flex-1 ${isDropTarget ? 'text-[#89b4fa] font-medium' : 'text-[#cdd6f4]'}`}>{node.name}</span>
          {isDropTarget && (
            <span className="text-[10px] text-[#89b4fa] animate-pulse">放置</span>
          )}
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
          <FolderTree key={child.path} node={child} expanded={expanded} currentNoteId={currentNoteId} depth={depth + 1}
            onToggle={onToggle} onSelectNote={onSelectNote} onDeleteNote={onDeleteNote}
            onCreateNoteInFolder={onCreateNoteInFolder}
            onFolderContextMenu={onFolderContextMenu}
            creatingSubFolder={creatingSubFolder} subFolderName={subFolderName}
            onSubFolderNameChange={onSubFolderNameChange} onConfirmSubFolder={onConfirmSubFolder}
            onCancelSubFolder={onCancelSubFolder} renderNoteItem={renderNoteItem}
            onDragOver={onDragOver} onDrop={onDrop} dropTargetPath={dropTargetPath} />
        ))}
          {node.notes.map((note) => renderNoteItem(note, (node.path ? depth + 1 : depth) * 12 + 24))}
        </div>
      )}
    </div>
  )
}

interface DailyTreeProps {
  tree: FolderNode; expanded: Set<string>; currentNoteId: string | null
  onToggle: (path: string) => void; onSelectNote: (noteId: string) => void; onDeleteNote: (noteId: string) => void
  renderNoteItem: (note: NoteMeta, paddingLeft: number) => React.ReactNode
  onDailyContextMenu: (e: React.MouseEvent, type: 'section' | 'note' | 'daily-year' | 'daily-month', noteId?: string, year?: string, month?: string) => void
  onCreateDailyNote: (date?: string) => void
}

function DailyTree({ tree, expanded, currentNoteId, onToggle, renderNoteItem, onDailyContextMenu, onCreateDailyNote }: DailyTreeProps) {
  const [creatingDate, setCreatingDate] = useState<string | null>(null)
  const [dateInput, setDateInput] = useState('')

  const handleCreateInMonth = (year: string, month: string) => {
    setCreatingDate(`${year}-${month}`)
    setDateInput('')
  }

  const handleConfirmCreateDate = (yearMonth: string) => {
    if (dateInput) {
      const day = dateInput.padStart(2, '0')
      const fullDate = `${yearMonth}-${day}`
      onCreateDailyNote(fullDate)
      setCreatingDate(null)
      setDateInput('')
    }
  }

  if (tree.children.length === 0 && tree.notes.length === 0) {
    return (
      <div 
        data-custom-context-menu="true"
        className="px-4 py-3 text-xs text-[#6c7086] text-center cursor-pointer hover:bg-[#313244] rounded mx-2"
        onContextMenu={(e) => onDailyContextMenu(e, 'section')}
      >
        Click the calendar icon or right-click to create a daily note
      </div>
    )
  }
  return (
    <div data-custom-context-menu="true" onContextMenu={(e) => onDailyContextMenu(e, 'section')}>
      {tree.children.map((yearNode) => (
        <div key={yearNode.path}>
          <div data-custom-context-menu="true" className="folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group"
            style={{ paddingLeft: '8px' }} onClick={() => onToggle(yearNode.path)}
            onContextMenu={(e) => onDailyContextMenu(e, 'daily-year', undefined, yearNode.name)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
              className={`transition-transform ${expanded.has(yearNode.path) ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[#89b4fa] font-medium">{yearNode.name}</span>
          </div>
          {expanded.has(yearNode.path) && yearNode.children.map((monthNode) => {
            // Extract month number from path (daily/YYYY/MM)
            const monthNum = monthNode.path.split('/')[2]
            const isCreating = creatingDate === `${yearNode.name}-${monthNum}`
            
            return (
              <div key={monthNode.path}>
                <div data-custom-context-menu="true" className="folder-item flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm group"
                  style={{ paddingLeft: '24px' }} onClick={() => onToggle(monthNode.path)}
                  onContextMenu={(e) => onDailyContextMenu(e, 'daily-month', undefined, yearNode.name, monthNum)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2"
                    className={`transition-transform ${expanded.has(monthNode.path) ? 'rotate-90' : ''}`}><path d="M9 18l6-6-6-6" /></svg>
                  <span className="text-[#a6adc8]">{monthNode.name}</span>
                  <span className="text-[10px] text-[#6c7086] ml-auto">{monthNode.notes.length}</span>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCreateInMonth(yearNode.name, monthNum)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[#585b70] text-[#6c7086] hover:text-[#a6e3a1] transition-opacity"
                    title="Create note in this month"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
                {isCreating && (
                  <div className="flex items-center gap-1.5 px-2 py-1" style={{ paddingLeft: '40px' }}>
                    <span className="text-[#6c7086] text-xs">{yearNode.name}-{monthNum}-</span>
                    <input 
                      autoFocus
                      type="number"
                      min="1"
                      max="31"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmCreateDate(`${yearNode.name}-${monthNum}`)
                        if (e.key === 'Escape') { setCreatingDate(null); setDateInput('') }
                      }}
                      onBlur={() => {
                        if (dateInput) handleConfirmCreateDate(`${yearNode.name}-${monthNum}`)
                        else setCreatingDate(null)
                      }}
                      placeholder="DD"
                      className="w-10 bg-[#313244] text-sm text-[#cdd6f4] rounded px-1 py-0.5 outline-none border border-[#45475a] focus:border-[#cba6f7]"
                    />
                  </div>
                )}
                {expanded.has(monthNode.path) && monthNode.notes.map((note) => (
                  <div key={note.id} data-custom-context-menu="true" onContextMenu={(e) => onDailyContextMenu(e, 'note', note.id)}>
                    {renderNoteItem(note, 44)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ))}
      {tree.notes.map((note) => (
        <div key={note.id} data-custom-context-menu="true" onContextMenu={(e) => onDailyContextMenu(e, 'note', note.id)}>
          {renderNoteItem(note, 24)}
        </div>
      ))}
    </div>
  )
}
