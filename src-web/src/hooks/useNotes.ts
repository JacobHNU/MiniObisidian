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
      const updated = await api.renameNote(noteId, newTitle)
      await refreshNotes()
      return updated
    },
    [refreshNotes]
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
