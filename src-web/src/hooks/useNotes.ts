import { useState, useEffect, useCallback } from 'react'
import * as api from '../ipc/tauri'

export function useNotes(vaultReady: boolean = true) {
  const [notes, setNotes] = useState<api.NoteMeta[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshNotes = useCallback(async () => {
    if (!vaultReady) return
    try {
      setLoading(true)
      const result = await api.listNotes()
      setNotes(result)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [vaultReady])

  const refreshFolders = useCallback(async () => {
    if (!vaultReady) return
    try {
      const result = await api.listFolders()
      setFolders(result)
    } catch (e) {
      console.error('Failed to load folders:', e)
    }
  }, [vaultReady])

  // Only load notes/folders when vault is ready
  useEffect(() => {
    if (vaultReady) {
      refreshNotes()
      refreshFolders()
    }
  }, [vaultReady, refreshNotes, refreshFolders])

  const createNote = useCallback(
    async (title: string, body: string, folder?: string, tags?: string[]) => {
      const note = await api.createNote(title, body, folder, tags)
      await refreshNotes()
      return note
    },
    [refreshNotes]
  )

  const updateNote = useCallback(
    async (noteId: string, content: string) => {
      const updated = await api.updateNote(noteId, content)
      await refreshNotes()
      return updated
    },
    [refreshNotes]
  )

  const deleteNote = useCallback(
    async (noteId: string) => {
      await api.deleteNote(noteId)
      await refreshNotes()
    },
    [refreshNotes]
  )

  const renameNote = useCallback(
    async (noteId: string, newTitle: string) => {
      // Capture old title for potential revert (read from current state via functional updater)
      let oldTitle: string | undefined
      setNotes(prev => {
        oldTitle = prev.find(n => n.id === noteId)?.title
        return prev.map(n => n.id === noteId ? { ...n, title: newTitle } : n)
      })
      try {
        const updated = await api.renameNote(noteId, newTitle)
        // Merge backend result into local state (no full refresh to avoid race condition
        // with concurrent renames overwriting each other's optimistic updates)
        setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updated } : n))
        return updated
      } catch (e) {
        // Revert only this note on failure
        if (oldTitle != null) {
          setNotes(prev => prev.map(n => n.id === noteId ? { ...n, title: oldTitle! } : n))
        }
        throw e
      }
    },
    []
  )

  const moveNote = useCallback(
    async (noteId: string, targetFolder: string) => {
      const updated = await api.moveNote(noteId, targetFolder)
      await refreshNotes()
      return updated
    },
    [refreshNotes]
  )

  return {
    notes,
    folders,
    loading,
    error,
    refreshNotes,
    refreshFolders,
    createNote,
    updateNote,
    deleteNote,
    renameNote,
    moveNote,
  }
}
