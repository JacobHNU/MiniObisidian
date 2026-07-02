import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useI18n, type TranslationKey } from './i18n'
import Sidebar from './components/Sidebar/Sidebar'
import EditorPanel from './components/Editor/EditorPanel'
import SearchPanel from './components/Search/SearchPanel'
import GraphView from './components/Graph/GraphView'
import VaultSetup from './components/VaultSetup'
import AIPanel from './components/AI/AIPanel'
import SyncPanel from './components/Sync/SyncPanel'
import BacklinksPanel from './components/Backlinks/BacklinksPanel'
import TabBar, { Tab } from './components/TabBar/TabBar'
import ExportPDFDialog, { ExportOptions } from './components/PDF/ExportPDFDialog'
import SettingsPanel, { loadSettings, applyTheme, applyFontSizes } from './components/Settings/SettingsPanel'
import GuideView, { GUIDE_TAB_ID } from './components/Guide/GuideDialog'
import * as api from './ipc/tauri'
import { useNotes } from './hooks/useNotes'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { DEFAULT_SHORTCUTS } from './shortcuts/defaults'

/**
 * Extract text from a base64-encoded PDF for AI context.
 * Uses dynamic import so pdfjs-dist is NOT loaded at app startup,
 * avoiding the top-level await error that crashes the entire UI.
 */
async function extractPdfText(base64Data: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    // Configure worker using Vite's ?url import for correct bundled URL
    try {
      const workerMod = await import('pdfjs-dist/build/pdf.worker.mjs?url')
      pdfjsLib.GlobalWorkerOptions.workerSrc = (workerMod as { default: string }).default
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ''
    }

    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    let fullText = ''
    const maxPages = Math.min(pdf.numPages, 200)
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items.map((item: any) => item.str).join(' ')
      fullText += `\n[${t('ai.pageLabel', { num: i })}]\n${pageText}`
    }
    return fullText.trim()
  } catch (err) {
    console.error('Failed to extract PDF text:', err)
    return ''
  }
}

type ViewMode = 'edit' | 'preview' | 'split' | 'graph' | 'search'

interface TabState {
  content: string
  filePath: string
  isPdf?: boolean
  pdfDataUrl?: string
}

export default function App() {
  const { t } = useI18n()
  const [vaultReady, setVaultReady] = useState(false)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [tabContents, setTabContents] = useState<Record<string, TabState>>({})
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'pending'>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiPrefillText, setAiPrefillText] = useState<string | undefined>(undefined)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [exportPdfDialog, setExportPdfDialog] = useState<{ isOpen: boolean; noteTitle: string; noteContent: string }>({
    isOpen: false, noteTitle: '', noteContent: ''
  })
  const tabContentsRef = useRef<Record<string, TabState>>({})
  const activeTabIdRef = useRef<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null)

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  // Apply saved settings (theme, font sizes) on app startup
  useEffect(() => {
    const saved = loadSettings()
    applyTheme(saved.theme)
    applyFontSizes(saved.uiFontSize, saved.editorFontSize)
  }, [])

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
    renameNote,
    refreshNotes,
    refreshFolders,
  } = useNotes(vaultReady)

  // Keep refs in sync
  useEffect(() => { tabContentsRef.current = tabContents }, [tabContents])
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])

  // Need a ref for tabs to avoid stale closures in shortcut handlers
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

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
    // Save all open tabs (skip PDFs to prevent corruption)
    const contents = tabContentsRef.current
    for (const [tabId, state] of Object.entries(contents)) {
      if (state.isPdf) continue // Never save PDF tabs
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
  // IMPORTANT: Skip PDF tabs to prevent corrupting PDF files
  const saveTab = useCallback(async (tabId: string) => {
    if (tabId === GUIDE_TAB_ID) return // Guide tab is read-only
    const state = tabContentsRef.current[tabId]
    if (state?.isPdf) return // Never save PDF tabs - they are read-only
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
        title: noteTitle || t('app.untitled'),
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

  // Open guide as a tab in the editor area
  const handleOpenGuide = useCallback(() => {
    const existingTab = tabs.find(t => t.id === GUIDE_TAB_ID)
    if (existingTab) {
      setActiveTabId(GUIDE_TAB_ID)
      return
    }
    setTabs(prev => [...prev, { id: GUIDE_TAB_ID, title: '新手入门指南', filePath: '' }])
    setActiveTabId(GUIDE_TAB_ID)
    setViewMode('preview')
  }, [tabs])

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
  // Uses refs to avoid stale closures - always reads the latest activeTabId
  const handleContentChange = useCallback(
    (content: string) => {
      const currentTabId = activeTabIdRef.current
      if (!currentTabId) return

      // Never auto-save PDF tabs
      const currentTab = tabContentsRef.current[currentTabId]
      if (currentTab?.isPdf) return

      setTabContents(prev => ({
        ...prev,
        [currentTabId]: { ...prev[currentTabId], content },
      }))

      // Auto-save with debounce - capture tabId at timer creation time
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      const tabIdAtSave = currentTabId
      saveTimerRef.current = setTimeout(async () => {
        // Verify the tab is still active before saving
        if (activeTabIdRef.current !== tabIdAtSave) return
        try {
          await api.updateNote(tabIdAtSave, content)
          // Update search index for this note (fire-and-forget)
          api.updateSearchIndexForNote(tabIdAtSave).catch(() => {})
        } catch (e) {
          console.error('Auto-save failed:', e)
        }
      }, 1000)
    },
    [] // No dependencies - uses refs for latest values
  )

  const handleCreateNote = useCallback(async () => {
    try {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const noteTitle = `Note-${today}-${timeStr}`
      const body = `[[${today}]]\n\n`
      const note = await createNote(noteTitle, body, 'inbox', [])

      // Read the full content (with frontmatter) from the backend
      const fullContent = await api.readNoteByPath(note.path)

      // Open in new tab
      const newTab: Tab = { id: note.id, title: noteTitle, filePath: note.path }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content: fullContent, filePath: note.path },
      }))
    } catch (e) {
      console.error('Failed to create note:', e)
      alert(t('app.createNoteFailed') + String(e))
    }
  }, [createNote, t])

  const handleCreateNoteInFolder = useCallback(async (folder: string) => {
    try {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 5).replace(':', '')
      const noteTitle = `Note-${today}-${timeStr}`
      const body = `[[${today}]]\n\n`
      const note = await createNote(noteTitle, body, folder, [])

      // Read the full content (with frontmatter) from the backend
      const fullContent = await api.readNoteByPath(note.path)

      const newTab: Tab = { id: note.id, title: noteTitle, filePath: note.path }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content: fullContent, filePath: note.path },
      }))
    } catch (e) {
      console.error('Failed to create note:', e)
      alert(t('app.createNoteFailed') + String(e))
    }
  }, [createNote, t])

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
    // Capture old tab title for potential revert
    const oldTab = tabs.find(t => t.id === noteId)
    // Capture old content for potential revert
    const oldContent = tabContentsRef.current[noteId]?.content
    // Optimistic update: update tab title immediately (sync with sidebar rename)
    setTabs(prev => prev.map(t => t.id === noteId ? { ...t, title: newTitle } : t))
    try {
      const updated = await renameNote(noteId, newTitle)
      // Sync tab content with backend to prevent auto-save from overwriting the new title
      // Cancel any pending auto-save first
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      // Read the updated file content (with new title in frontmatter)
      try {
        const freshContent = await api.readNoteByPath(updated.path)
        setTabContents(prev => ({
          ...prev,
          [noteId]: { ...prev[noteId], content: freshContent },
        }))
      } catch (readErr) {
        console.error('Failed to read updated note content:', readErr)
      }
    } catch (e) {
      console.error('Failed to rename note:', e)
      // Revert tab title on failure
      if (oldTab) {
        setTabs(prev => prev.map(t => t.id === noteId ? { ...t, title: oldTab.title } : t))
      }
      // Revert tab content on failure
      if (oldContent != null) {
        setTabContents(prev => ({
          ...prev,
          [noteId]: { ...prev[noteId], content: oldContent },
        }))
      }
    }
  }, [renameNote, tabs])

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
        setToast({ message: t('app.deleteNoteFailed') + String(e), type: 'error' })
      }
    },
    [deleteNote, tabs, handleTabClose, t]
  )

  const handleDeleteFolder = useCallback(async (folderPath: string) => {
    try {
      await api.deleteFolder(folderPath)
      // Close tabs that belong to the deleted folder
      const prefix = folderPath + '/'
      const tabsToClose = tabs.filter(t => t.filePath.startsWith(prefix))
      for (const tab of tabsToClose) {
        await handleTabClose(tab.id)
      }
      await refreshNotes()
      await refreshFolders()
      setToast({ message: t('app.folderDeleted'), type: 'success' })
    } catch (e) {
      console.error('Failed to delete folder:', e)
      setToast({ message: t('app.deleteFolderFailed') + String(e), type: 'error' })
    }
  }, [tabs, handleTabClose, refreshNotes, refreshFolders, t])

  // Refresh current note content from disk (called after tag changes)
  const handleRefreshContent = useCallback(async () => {
    const tabId = activeTabIdRef.current
    if (!tabId) return
    const state = tabContentsRef.current[tabId]
    if (!state?.filePath || state.isPdf) return
    // Cancel pending auto-save to prevent overwriting refreshed content
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    try {
      const content = await api.readNoteByPath(state.filePath)
      setTabContents(prev => ({
        ...prev,
        [tabId]: { ...prev[tabId], content },
      }))
    } catch (e) {
      console.error('Failed to refresh content:', e)
    }
  }, [])

  // Send selected PDF text to AI Q&A panel
  const handleSendToAI = useCallback((text: string) => {
    setAiPrefillText(text)
    setAiPanelOpen(true)
  }, [])

  // Write AI response content to an existing note (append)
  const handleWriteToNote = useCallback(async (noteId: string, content: string) => {
    const currentTabContent = tabContentsRef.current[noteId]
    if (currentTabContent) {
      const newContent = currentTabContent.content + content
      setTabContents(prev => ({
        ...prev,
        [noteId]: { ...prev[noteId], content: newContent },
      }))
      try {
        await api.updateNote(noteId, newContent)
      } catch (e) {
        console.error('Failed to write to note:', e)
        setToast({ message: t('app.writeNoteFailed') + String(e), type: 'error' })
      }
    }
  }, [setToast, t])

  // Create a new note from AI response
  const handleCreateNoteFromAI = useCallback(async (title: string, content: string) => {
    try {
      const note = await createNote(title, content, 'inbox', [])
      await refreshNotes()
      const fullContent = await api.readNoteByPath(note.path)
      const newTab: Tab = { id: note.id, title, filePath: note.path }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(note.id)
      setTabContents(prev => ({
        ...prev,
        [note.id]: { content: fullContent, filePath: note.path },
      }))
    } catch (e) {
      console.error('Failed to create note from AI:', e)
      setToast({ message: t('app.createNoteFailed') + String(e), type: 'error' })
    }
  }, [createNote, refreshNotes, setToast, t])

  const handleMoveNote = useCallback(async (noteId: string, destPath: string) => {
    try {
      await api.moveNote(noteId, destPath)
      await refreshNotes()
      await refreshFolders()
      setToast({ message: t('app.noteMoved'), type: 'success' })
    } catch (e) {
      console.error('Failed to move note:', e)
      setToast({ message: t('app.moveNoteFailed') + String(e), type: 'error' })
    }
  }, [refreshNotes, refreshFolders, t])

  // ── Keyboard Shortcuts ────────────────────────────────────────────
  const shortcutHandlers = useMemo(() => ({
    'file.newNote': () => { handleCreateNote() },
    'file.save': () => {
      const tabId = activeTabIdRef.current
      if (tabId) saveTab(tabId)
    },
    'file.closeTab': () => {
      const tabId = activeTabIdRef.current
      if (tabId) handleTabClose(tabId)
    },
    'file.dailyNote': () => { handleCreateDailyNote() },
    'file.exportPdf': () => {
      const tabId = activeTabIdRef.current
      if (tabId && tabContentsRef.current[tabId]) {
        const state = tabContentsRef.current[tabId]
        setExportPdfDialog({ isOpen: true, noteTitle: tabsRef.current.find(t => t.id === tabId)?.title || '', noteContent: state.content })
      }
    },
    'view.edit': () => setViewMode('edit'),
    'view.split': () => setViewMode('split'),
    'view.preview': () => setViewMode('preview'),
    'view.graph': () => setViewMode('graph'),
    'view.search': () => setViewMode('search'),
    'panel.sidebar': () => setSidebarOpen(prev => !prev),
    'panel.ai': () => setAiPanelOpen(prev => !prev),
    'panel.sync': () => setSyncPanelOpen(prev => !prev),
    'panel.settings': () => setSettingsOpen(prev => !prev),
    'panel.backlinks': () => {},
    'tab.next': () => {
      const currentTabs = tabsRef.current
      const activeId = activeTabIdRef.current
      if (currentTabs.length < 2 || !activeId) return
      const idx = currentTabs.findIndex(t => t.id === activeId)
      const next = currentTabs[(idx + 1) % currentTabs.length]
      if (next) handleTabClick(next.id)
    },
    'tab.prev': () => {
      const currentTabs = tabsRef.current
      const activeId = activeTabIdRef.current
      if (currentTabs.length < 2 || !activeId) return
      const idx = currentTabs.findIndex(t => t.id === activeId)
      const prev = currentTabs[(idx - 1 + currentTabs.length) % currentTabs.length]
      if (prev) handleTabClick(prev.id)
    },
    'editor.search': () => {},
    'editor.findReplace': () => {},
    'editor.bold': () => {},
    'editor.italic': () => {},
    'editor.code': () => {},
    'editor.link': () => {},
    'editor.heading': () => {},
    'editor.list': () => {},
  }), [handleCreateNote, saveTab, handleTabClose, handleTabClick, handleCreateDailyNote])

  const { bindings: shortcutBindings, updateBinding, resetBinding, resetAll } = useKeyboardShortcuts(
    DEFAULT_SHORTCUTS,
    shortcutHandlers
  )

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
    <div className="flex h-screen w-screen overflow-hidden bg-base">
      {/* Sidebar */}
      {sidebarOpen && (
        <Sidebar
          notes={notes}
          folders={folders}
          currentNoteId={activeTabId}
          onSelectNote={handleSelectNote}
          onOpenPdf={(base64Data, fileName, noteId) => {
            // Create a tab for the PDF
            const pdfTab: Tab = {
              id: noteId || `pdf-${Date.now()}`,
              title: fileName,
              filePath: `pdf:${fileName}`,
            }

            setTabs(prev => {
              if (prev.find(t => t.id === pdfTab.id)) {
                setActiveTabId(pdfTab.id)
                return prev
              }
              return [...prev, pdfTab]
            })
            setActiveTabId(pdfTab.id)
            setTabContents(prev => ({
              ...prev,
              [pdfTab.id]: {
                content: '',  // will be updated with extracted text below
                filePath: pdfTab.filePath,
                isPdf: true,
                pdfDataUrl: base64Data,  // raw base64, no data: prefix
              },
            }))
            setViewMode('preview')

            // Asynchronously extract PDF text for AI context
            extractPdfText(base64Data, t).then((extractedText) => {
              if (extractedText) {
                setTabContents(prev => ({
                  ...prev,
                  [pdfTab.id]: {
                    ...prev[pdfTab.id],
                    content: extractedText,
                  },
                }))
              }
            })
          }}
          onCreateNote={handleCreateNote}
          onCreateNoteInFolder={handleCreateNoteInFolder}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onCreateDailyNote={handleCreateDailyNote}
          onDeleteNote={handleDeleteNote}
          onRenameNote={handleRenameNote}
          onMoveNote={handleMoveNote}
          onClose={() => setSidebarOpen(false)}
          onSwitchVault={handleSwitchVault}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col bg-base overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border-muted shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded hover:bg-muted text-text-primary"
              title={t('app.toggleSidebar')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
          <div className="flex-1 text-sm text-text-secondary truncate min-w-0">
            {currentNote?.title || t('app.noNoteSelected')}
          </div>
          <div className="flex gap-1 shrink-0 items-center">
            {(['edit', 'split', 'preview', 'graph', 'search'] as ViewMode[]).map(
              (mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-accent text-text-inverse'
                      : 'text-text-secondary hover:bg-muted'
                  }`}
                >
                  {mode === 'edit'
                    ? t('app.edit')
                    : mode === 'split'
                    ? t('app.split')
                    : mode === 'preview'
                    ? t('app.preview')
                    : mode === 'graph'
                    ? t('app.graph')
                    : t('app.search')}
                </button>
              )
            )}
            <div className="w-px h-4 bg-hover mx-1" />
            <button
              onClick={() => setSyncPanelOpen(true)}
              className="px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 text-text-secondary hover:bg-muted relative"
              title={t('app.cloudSync')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
              </svg>
              <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                syncStatus === 'syncing' ? 'bg-blue animate-pulse' :
                syncStatus === 'error' ? 'bg-red' :
                syncStatus === 'pending' ? 'bg-yellow' :
                'bg-green'
              }`} />
              {t('app.sync')}
            </button>
            <button
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                aiPanelOpen
                  ? 'bg-accent text-text-inverse'
                  : 'text-text-secondary hover:bg-muted'
              }`}
              title={t('app.aiAssistant')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              {t('app.ai')}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-2 py-1 rounded text-xs font-medium transition-colors text-text-secondary hover:bg-muted"
              title={t('app.settings')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
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
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
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
          ) : activeTabId === GUIDE_TAB_ID ? (
            <GuideView />
          ) : activeTabId ? (
            <>
              <div className="flex-1 min-h-0 overflow-hidden">
                <EditorPanel
                  key={activeTabId}
                  content={currentContent}
                  onChange={handleContentChange}
                  viewMode={viewMode}
                  currentNoteId={activeTabId}
                  onWikiLinkClick={handleWikiLinkClick}
                  isPdf={tabContents[activeTabId]?.isPdf}
                  pdfDataUrl={tabContents[activeTabId]?.pdfDataUrl}
                  onSendToAI={handleSendToAI}
                  onRefreshContent={handleRefreshContent}
                  onToast={(msg, type) => setToast({ message: msg, type })}
                />
              </div>
              <BacklinksPanel
                noteId={activeTabId}
                onSelectNote={handleSelectNote}
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              <div className="text-center">
                <div className="text-6xl mb-4 opacity-30">📝</div>
                <p className="text-lg">{t('app.selectNoteHint')}</p>
                <p className="text-sm mt-2">{t('app.createNoteHint')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Panel */}
      <AIPanel
        isOpen={aiPanelOpen}
        onClose={() => { setAiPanelOpen(false); setAiPrefillText(undefined) }}
        currentNoteId={activeTabId}
        currentNoteContent={currentContent}
        currentNoteTitle={currentNote?.title || ''}
        openNotes={tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          content: tabContents[tab.id]?.content || '',
          isActive: tab.id === activeTabId,
        }))}
        prefillText={aiPrefillText}
        onWriteToNote={handleWriteToNote}
        onCreateNoteFromAI={handleCreateNoteFromAI}
        onToast={(msg, type) => setToast({ message: msg, type })}
      />

      {/* Sync Panel */}
      <SyncPanel
        isOpen={syncPanelOpen}
        onClose={() => setSyncPanelOpen(false)}
        onSyncStatusChange={setSyncStatus}
      />

      {/* Export PDF Dialog */}
      <ExportPDFDialog
        isOpen={exportPdfDialog.isOpen}
        noteTitle={exportPdfDialog.noteTitle}
        noteContent={exportPdfDialog.noteContent}
        onExport={(options: ExportOptions) => {
          // Export logic would go here
          console.log('Export PDF with options:', options)
          setExportPdfDialog({ isOpen: false, noteTitle: '', noteContent: '' })
        }}
        onClose={() => setExportPdfDialog({ isOpen: false, noteTitle: '', noteContent: '' })}
      />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenGuide={() => {
          setSettingsOpen(false)
          handleOpenGuide()
        }}
        shortcutBindings={shortcutBindings}
        onUpdateShortcut={updateBinding}
        onResetShortcut={resetBinding}
        onResetAllShortcuts={resetAll}
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-lg shadow-2xl text-sm font-medium flex items-center gap-3 animate-fade-in ${
          toast.type === 'error'
            ? 'bg-red text-text-inverse'
            : 'bg-green text-text-inverse'
        }`}>
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
