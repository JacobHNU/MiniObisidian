import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import EditorPanel from './components/Editor/EditorPanel'
import SearchPanel from './components/Search/SearchPanel'
import GraphView from './components/Graph/GraphView'
import VaultSetup from './components/VaultSetup'
import * as api from './ipc/tauri'
import { useNotes } from './hooks/useNotes'

type ViewMode = 'edit' | 'preview' | 'split' | 'graph' | 'search'

export default function App() {
  const [vaultReady, setVaultReady] = useState(false)
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [currentContent, setCurrentContent] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the latest content to avoid stale closures in auto-save
  const contentRef = useRef<string>('')
  const noteIdRef = useRef<string | null>(null)
  const notePathRef = useRef<string | null>(null)

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

  // Keep refs in sync
  useEffect(() => { contentRef.current = currentContent }, [currentContent])
  useEffect(() => { noteIdRef.current = currentNoteId }, [currentNoteId])

  // Check for existing vault on mount
  useEffect(() => {
    const savedPath = localStorage.getItem('vault_path')
    if (savedPath) {
      api
        .initVault(savedPath)
        .then(() => {
          setVaultReady(true)
        })
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

  // Switch to a different vault
  const handleSwitchVault = useCallback(() => {
    // Cancel any pending auto-save
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    // Save current note if any
    const prevId = noteIdRef.current
    const prevContent = contentRef.current
    if (prevId && prevContent) {
      api.updateNote(prevId, prevContent).catch(() => {})
    }
    // Reset all state
    setCurrentNoteId(null)
    setCurrentContent('')
    contentRef.current = ''
    noteIdRef.current = null
    notePathRef.current = null
    setVaultReady(false)
    localStorage.removeItem('vault_path')
  }, [])

  const handleSelectNote = useCallback(
    async (noteId: string) => {
      // Cancel any pending auto-save first
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }

      // Save current note before switching — use refs to get latest values
      const prevId = noteIdRef.current
      const prevContent = contentRef.current
      if (prevId && prevId !== noteId && prevContent) {
        try {
          await api.updateNote(prevId, prevContent)
        } catch (e) {
          console.error('Failed to save previous note:', e)
        }
      }

      setCurrentNoteId(noteId)
      noteIdRef.current = noteId

      // Look up note path — try current list first, then re-fetch from backend
      let notePath: string | undefined = notes.find((n) => n.id === noteId)?.path
      if (!notePath) {
        try {
          const freshNotes = await api.listNotes()
          notePath = freshNotes.find((n) => n.id === noteId)?.path
        } catch {
          // ignore
        }
      }

      if (!notePath) {
        console.error('Note not found:', noteId)
        setCurrentContent('')
        return
      }

      notePathRef.current = notePath

      try {
        const content = await api.readNoteByPath(notePath)
        setCurrentContent(content)
        contentRef.current = content
      } catch (e) {
        console.error('Failed to read note:', e)
        setCurrentContent('')
      }
    },
    [notes]
  )

  const handleContentChange = useCallback(
    (content: string) => {
      setCurrentContent(content)
      contentRef.current = content

      // Auto-save with debounce
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      const noteId = noteIdRef.current
      if (noteId) {
        saveTimerRef.current = setTimeout(async () => {
          try {
            // Use ref to get latest content at save time
            await api.updateNote(noteId, contentRef.current)
          } catch (e) {
            console.error('Auto-save failed:', e)
          }
        }, 1000)
      }
    },
    []
  )

  const handleCreateNote = useCallback(async () => {
    try {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const noteTitle = `Note-${today}-${timeStr}`
      const body = `[[${today}]]\n\n`
      const note = await createNote(noteTitle, body, 'inbox', [])
      // Set content before setting ID to avoid race with auto-save
      const fullContent = `---\nid: "${note.id}"\ntitle: "${noteTitle}"\ntags: []\ncreated: "${now.toISOString()}"\nupdated: "${now.toISOString()}"\nlinks: ["${today}"]\n---\n\n${body}`
      setCurrentContent(fullContent)
      contentRef.current = fullContent
      setCurrentNoteId(note.id)
      noteIdRef.current = note.id
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
      setCurrentContent(fullContent)
      contentRef.current = fullContent
      setCurrentNoteId(note.id)
      noteIdRef.current = note.id
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

  const handleCreateDailyNote = useCallback(async () => {
    try {
      const note = await api.createDailyNote()
      await refreshNotes()
      setCurrentNoteId(note.id)
      noteIdRef.current = note.id
      const content = await api.readNoteByPath(note.path)
      setCurrentContent(content)
      contentRef.current = content
    } catch (e) {
      console.error('Failed to create daily note:', e)
    }
  }, [refreshNotes])

  const handleRenameNote = useCallback(async (noteId: string, newTitle: string) => {
    try {
      await api.renameNote(noteId, newTitle)
      await refreshNotes()
    } catch (e) {
      console.error('Failed to rename note:', e)
    }
  }, [refreshNotes])

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      try {
        await deleteNote(noteId)
        if (currentNoteId === noteId) {
          setCurrentNoteId(null)
          setCurrentContent('')
          contentRef.current = ''
          noteIdRef.current = null
        }
      } catch (e) {
        console.error('Failed to delete note:', e)
      }
    },
    [currentNoteId, deleteNote]
  )

  if (!vaultReady) {
    return <VaultSetup onInit={handleInitVault} />
  }

  const currentNote = notes.find((n) => n.id === currentNoteId)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1e1e2e]">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          notes={notes}
          folders={folders}
          currentNoteId={currentNoteId}
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
          <div className="flex gap-1 shrink-0">
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
          </div>
        </div>

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
          ) : currentNoteId ? (
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
    </div>
  )
}
