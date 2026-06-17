import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import EditorPanel from './components/Editor/EditorPanel'
import SearchPanel from './components/Search/SearchPanel'
import GraphView from './components/Graph/GraphView'
import VaultSetup from './components/VaultSetup'
import AIPanel from './components/AI/AIPanel'
import SyncPanel from './components/Sync/SyncPanel'
import TabBar, { Tab } from './components/TabBar/TabBar'
import * as api from './ipc/tauri'
import { useNotes } from './hooks/useNotes'

type ViewMode = 'edit' | 'preview' | 'split' | 'graph' | 'search'

interface TabState {
  content: string
  filePath: string
}

export default function App() {
  const [vaultReady, setVaultReady] = useState(false)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [tabContents, setTabContents] = useState<Record<string, TabState>>({})
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabContentsRef = useRef<Record<string, TabState>>({})

  // Block default browser right-click menu
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Don't block if it's our custom menu trigger (marked with data-custom-context-menu)
      if ((e.target as HTMLElement).closest('[data-custom-context-menu]')) {
        return
      }
      e.preventDefault()
    }

    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])

  const {
    notes,
    folders,
    loading,
    createNote,
    updateNote,
    deleteNote,
    refreshNotes,
    refreshFolders,
  } = useNotes(vaultReady)

  // Keep ref in sync
  useEffect(() => { tabContentsRef.current = tabContents }, [tabContents])

  // Check for existing vault on mount
  useEffect(() => {
    const savedPath = localStorage.getItem('vault_path')
    if (savedPath) {
      api
        .initVault(savedPath)
        .then(() => setVaultReady(true))
        .catch((e) => {
          console.error('Failed to init vault from saved path:', e)
          localStorage.removeItem('vault_path')
        })
    }
  }, [])

  const handleInitVault = useCallback(async (path: string) => {
    try {
      await api.initVault(path)
      localStorage.setItem('vault_path', path)
      setVaultReady(true)
    } catch (e) {
      console.error('Failed to initialize vault:', e)
      throw e
    }
  }, [])

  const handleSwitchVault = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    // Save all open tabs
    const contents = tabContentsRef.current
    for (const [tabId, state] of Object.entries(contents)) {
      if (state.content) {
        api.updateNote(tabId, state.content).catch(() => {})
      }
    }
    setTabs([])
    setActiveTabId(null)
    setTabContents({})
    setVaultReady(false)
    localStorage.removeItem('vault_path')
  }, [])

  // Save a specific tab's content to backend
  const saveTab = useCallback(async (tabId: string) => {
    const state = tabContentsRef.current[tabId]
    if (state?.content) {
      try {
        await api.updateNote(tabId, state.content)
      } catch (e) {
        console.error('Failed to save tab:', e)
      }
    }
  }, [])

  // Open a note in a tab (create new tab or switch to existing)
  const handleSelectNote = useCallback(
    async (noteId: string) => {
      // Cancel pending auto-save
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      // Save current active tab before switching
      if (activeTabId && activeTabId !== noteId) {
        await saveTab(activeTabId)
      }

      // Check if tab already exists
      const existingTab = tabs.find(t => t.id === noteId)
      if (existingTab) {
        setActiveTabId(noteId)
        return
      }

      // Find note info
      let notePath: string | undefined = notes.find((n) => n.id === noteId)?.path
      let noteTitle: string | undefined = notes.find((n) => n.id === noteId)?.title
      if (!notePath) {
        try {
          const freshNotes = await api.listNotes()
          const found = freshNotes.find((n) => n.id === noteId)
          notePath = found?.path
          noteTitle = found?.title
        } catch { /* ignore */ }
      }

      if (!notePath) {
        console.error('Note not found:', noteId)
        return
      }

      // Load content
      let content = ''
      try {
        content = await api.readNoteByPath(notePath)
      } catch (e) {
        console.error('Failed to read note:', e)
      }

      // Add new tab
      const newTab: Tab = {
        id: noteId,
        title: noteTitle || 'Untitled',
        filePath: notePath,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(noteId)
      setTabContents(prev => ({
        ...prev,
        [noteId]: { content, filePath: notePath! },
      }))
    },
    [activeTabId, tabs, notes, saveTab]
  )

  // Close a tab
  const handleTabClose = useCallback(async (tabId: string) => {
    // Save before closing
    await saveTab(tabId)

    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId)
      // If closing active tab, switch to adjacent
      if (tabId === activeTabId) {
        const closedIdx = prev.findIndex(t => t.id === tabId)
        const newActive = newTabs[Math.min(closedIdx, newTabs.length - 1)] || null
        setActiveTabId(newActive?.id || null)
      }
      return newTabs
    })
    setTabContents(prev => {
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [activeTabId, saveTab])

  // Switch active tab
  const handleTabClick = useCallback(async (tabId: string) => {
    if (tabId === activeTabId) return

    // Cancel pending auto-save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }

    // Save current tab
    if (activeTabId) {
      await saveTab(activeTabId)
    }

    setActiveTabId(tabId)
  }, [activeTabId, saveTab])

  // Content change handler for active tab
  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeTabId) return

      setTabContents(prev => ({
        ...prev,
        [activeTabId]: { ...prev[activeTabId], content },
      }))

      // Auto-save with debounce
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(async () => {
        try {
          await api.updateNote(activeTabId, content)
        } catch (e) {
          console.error('Auto-save failed:', e)
        }
      }, 1000)
    },
    [activeTabId]
  )

  const handleCreateNote = useCallback(async () => {
    try {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const noteTitle = `Note-${today}-${timeStr}`
      const body = `[[${today}]]\n\n`
      const note = await createNote(noteTitle, body, 'inbox', [])
      const fullContent = `---\nid: "${note.id}"\ntitle: "${noteTitle}"\ntags: []\ncreated: "${now.toISOString()}"\nupdated: "${now.toISOString()}"\nlinks: ["${today}"]\n---\n\n${body}`

      // Open in new tab
      const newTab: Tab = { id: note.id, title: noteTitle, filePath: '' }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content: fullContent, filePath: '' },
      }))
    } catch (e) {
      console.error('Failed to create note:', e)
      alert('Failed to create note: ' + String(e))
    }
  }, [createNote])

  const handleCreateNoteInFolder = useCallback(async (folder: string) => {
    try {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const noteTitle = `Note-${today}-${timeStr}`
      const body = `[[${today}]]\n\n`
      const note = await createNote(noteTitle, body, folder, [])
      const fullContent = `---\nid: "${note.id}"\ntitle: "${noteTitle}"\ntags: []\ncreated: "${now.toISOString()}"\nupdated: "${now.toISOString()}"\nlinks: ["${today}"]\n---\n\n${body}`

      const newTab: Tab = { id: note.id, title: noteTitle, filePath: '' }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content: fullContent, filePath: '' },
      }))
    } catch (e) {
      console.error('Failed to create note:', e)
      alert('Failed to create note: ' + String(e))
    }
  }, [createNote])

  const handleCreateFolder = useCallback(async (folderPath: string) => {
    try {
      await api.createFolder(folderPath)
      await refreshFolders()
    } catch (e) {
      console.error('Failed to create folder:', e)
    }
  }, [refreshFolders])

  const handleCreateDailyNote = useCallback(async (date?: string) => {
    try {
      const note = await api.createDailyNote(date)
      await refreshNotes()
      const content = await api.readNoteByPath(note.path)

      // Check if tab already exists (conflict handling)
      const existingTab = tabs.find(t => t.id === note.id)
      if (existingTab) {
        setActiveTabId(note.id)
        // Refresh content in case it was updated
        setTabContents(prev => ({
          ...prev,
          [note.id]: { content, filePath: note.path },
        }))
        return
      }

      const newTab: Tab = { id: note.id, title: note.title, filePath: note.path }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content, filePath: note.path },
      }))
    } catch (e) {
      console.error('Failed to create daily note:', e)
    }
  }, [refreshNotes, tabs])

  const handleRenameNote = useCallback(async (noteId: string, newTitle: string) => {
    try {
      await api.renameNote(noteId, newTitle)
      await refreshNotes()
      // Update tab title
      setTabs(prev => prev.map(t => t.id === noteId ? { ...t, title: newTitle } : t))
    } catch (e) {
      console.error('Failed to rename note:', e)
    }
  }, [refreshNotes])

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      try {
        await deleteNote(noteId)
        // Close tab if open
        if (tabs.find(t => t.id === noteId)) {
          await handleTabClose(noteId)
        }
      } catch (e) {
        console.error('Failed to delete note:', e)
      }
    },
    [deleteNote, tabs, handleTabClose]
  )

  const handleMoveNote = useCallback(async (noteId: string, destPath: string) => {
    try {
      await api.moveNote(noteId, destPath)
      await refreshNotes()
      await refreshFolders()
    } catch (e) {
      console.error('Failed to move note:', e)
    }
  }, [refreshNotes, refreshFolders])

  const handleWikiLinkClick = useCallback(async (noteTitle: string) => {
    const existingNote = notes.find((n) => n.title === noteTitle)
    if (existingNote) {
      await handleSelectNote(existingNote.id)
    } else {
      try {
        const newNote = await createNote(noteTitle, '', '', [])
        await refreshNotes()
        await handleSelectNote(newNote.id)
      } catch (e) {
        console.error('Failed to create note from wiki link:', e)
      }
    }
  }, [notes, handleSelectNote, createNote, refreshNotes])

  if (!vaultReady) {
    return <VaultSetup onInit={handleInitVault} />
  }

  const currentContent = activeTabId ? (tabContents[activeTabId]?.content || '') : ''
  const currentNote = notes.find((n) => n.id === activeTabId)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1e1e2e]">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          notes={notes}
          folders={folders}
          currentNoteId={activeTabId}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onCreateNoteInFolder={handleCreateNoteInFolder}
          onCreateFolder={handleCreateFolder}
          onCreateDailyNote={handleCreateDailyNote}
          onDeleteNote={handleDeleteNote}
          onRenameNote={handleRenameNote}
          onClose={() => setSidebarOpen(false)}
          onSwitchVault={handleSwitchVault}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#1e1e2e] overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-[#181825] border-b border-[#313244] shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded hover:bg-[#313244] text-[#cdd6f4]"
              title="Toggle sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          <div className="flex-1 text-sm text-[#a6adc8] truncate min-w-0">
            {currentNote?.title || 'No note selected'}
          </div>
          <div className="flex gap-1 shrink-0 items-center">
            {(['edit', 'split', 'preview', 'graph', 'search'] as ViewMode[]).map(
              (mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-[#cba6f7] text-[#1e1e2e]'
                      : 'text-[#a6adc8] hover:bg-[#313244]'
                  }`}
                >
                  {mode === 'edit'
                    ? 'Edit'
                    : mode === 'split'
                    ? 'Split'
                    : mode === 'preview'
                    ? 'Preview'
                    : mode === 'graph'
                    ? 'Graph'
                    : 'Search'}
                </button>
              )
            )}
            <div className="w-px h-4 bg-[#45475a] mx-1" />
            <button
              onClick={() => setSyncPanelOpen(true)}
              className="px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 text-[#a6adc8] hover:bg-[#313244]"
              title="Cloud Sync"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
              </svg>
              Sync
            </button>
            <button
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                aiPanelOpen
                  ? 'bg-[#cba6f7] text-[#1e1e2e]'
                  : 'text-[#a6adc8] hover:bg-[#313244]'
              }`}
              title="AI Assistant"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              AI
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
        />

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewMode === 'search' ? (
            <SearchPanel onSelectNote={handleSelectNote} />
          ) : viewMode === 'graph' ? (
            <GraphView
              onSelectNote={(nodeId) => {
                handleSelectNote(nodeId)
                setViewMode('split')
              }}
              notes={notes}
            />
          ) : activeTabId ? (
            <EditorPanel
              content={currentContent}
              onChange={handleContentChange}
              viewMode={viewMode}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[#6c7086]">
              <div className="text-center">
                <div className="text-6xl mb-4 opacity-30">📝</div>
                <p className="text-lg">Select a note or create a new one</p>
                <p className="text-sm mt-2">Press Ctrl+N to create a new note</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Panel */}
      <AIPanel
        isOpen={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        currentNoteContent={currentContent}
        currentNoteTitle={currentNote?.title || ''}
        openNotes={tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          content: tabContents[tab.id]?.content || '',
          isActive: tab.id === activeTabId,
        }))}
      />

      {/* Sync Panel */}
      <SyncPanel
        isOpen={syncPanelOpen}
        onClose={() => setSyncPanelOpen(false)}
      />
    </div>
  )
}
