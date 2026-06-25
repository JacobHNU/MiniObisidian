import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface NoteMeta {
  id: string
  path: string
  title: string
  tags: string[]
  content_hash: string
  created_at: string
  updated_at: string
}

export interface FileInfo {
  name: string
  path: string
  size: number
  modified: number | null
}

export interface GraphData {
  nodes: { id: string; title: string; path: string; tags: string[] }[]
  edges: { source: string; target: string }[]
}

export interface VaultInfo {
  path: string
  note_count: number
}

export interface NoteContent {
  title: string
  body: string
  tags: string[]
  raw: string
}

// Vault operations
export const initVault = (vaultPath: string) =>
  invoke<VaultInfo>('init_vault', { vaultPath })

export const getVaultPath = () =>
  invoke<string | null>('get_vault_path')

// Note CRUD
export const createNote = (
  title: string,
  body: string,
  folder?: string,
  tags?: string[]
) => invoke<NoteMeta>('create_note', { title, body, folder, tags })

export const readNote = (noteId: string) =>
  invoke<NoteContent | null>('read_note', { noteId })

export const readNoteByPath = (path: string) =>
  invoke<string>('read_note_by_path', { path })

export const updateNote = (noteId: string, content: string) =>
  invoke<NoteMeta>('update_note', { noteId, content })

export const deleteNote = (noteId: string) =>
  invoke<void>('delete_note', { noteId })

// Listing
export const listNotes = () =>
  invoke<NoteMeta[]>('list_notes')

export const listFolders = () =>
  invoke<string[]>('list_folders')

export const listFiles = (folder: string) =>
  invoke<FileInfo[]>('list_files', { folder })

// Folder operations
export const createFolder = (folderPath: string) =>
  invoke<void>('create_folder', { folderPath })

export const deleteFolder = (folderPath: string) =>
  invoke<void>('delete_folder', { folderPath })

// Note operations
export const renameNote = (noteId: string, newTitle: string) =>
  invoke<NoteMeta>('rename_note', { noteId, newTitle })

export const moveNote = (noteId: string, targetFolder: string) =>
  invoke<NoteMeta>('move_note', { noteId, targetFolder })

// Scan
export const scanVault = () =>
  invoke<NoteMeta[]>('scan_vault')

// Graph
export const getGraphData = () =>
  invoke<GraphData>('get_graph_data')

// Daily note
export const createDailyNote = (date?: string) =>
  invoke<NoteMeta>('create_daily_note', { date: date || null })

// Show file in system file explorer
export const showInFolder = (notePath: string) =>
  invoke<void>('show_in_folder', { notePath })

// Save base64 image to vault attachments, returns relative path
export const saveAttachment = (filename: string, dataBase64: string) =>
  invoke<string>('save_attachment', { filename, dataBase64 })

// Read an attachment file and return it as a base64 data URI
export const readAttachment = (relativePath: string) =>
  invoke<string>('read_attachment', { relativePath })

// Read a file from the vault and return raw base64 (without data URI prefix)
export const readFileBase64 = (relativePath: string) =>
  invoke<string>('read_file_base64', { relativePath })

// AI Chat
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ContextNote {
  id: string
  title: string
  content: string
}

export interface AiChatRequest {
  question: string
  noteContent: string
  noteTitle: string
  apiKey: string
  apiUrl: string
  model: string
  history: ChatMessage[]
  contextNotes?: ContextNote[]
}

export const aiChat = (request: AiChatRequest) =>
  invoke<string>('ai_chat', { request })

// AI Streaming Chat
export type AiStreamEventType =
  | { type: 'chunk'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/**
 * Start a streaming AI chat request.
 * Returns an unlisten function to cancel the stream.
 */
export async function aiChatStream(
  request: AiChatRequest,
  onChunk: (content: string) => void,
  onDone: () => void,
  onError: (message: string) => void,
): Promise<UnlistenFn> {
  const unlisten = await listen<AiStreamEventType>('ai-stream-event', (event) => {
    const data = event.payload
    switch (data.type) {
      case 'chunk':
        onChunk(data.content)
        break
      case 'done':
        onDone()
        break
      case 'error':
        onError(data.message)
        break
    }
  })

  // Fire the invoke (don't await - it runs in background, events arrive via listener)
  invoke('ai_chat_stream', { request }).catch((err) => {
    onError(String(err))
  })

  return unlisten
}

// Sync
export interface SyncConfig {
  includePatterns: string[]
  excludePatterns: string[]
  maxFileSize: number
  excludeDirs: string[]
  autoSyncEnabled: boolean
  autoSyncIntervalMinutes: number
  checkNetwork: boolean
  conflictStrategy: string
  syncTarget: string
}

export interface SyncStatus {
  isSyncing: boolean
  lastSync: string | null
  lastResult: SyncResult | null
  pendingChanges: number
  syncDir: string | null
}

export interface SyncResult {
  totalChanges: number
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  errors: { relativePath: string; message: string }[]
  startedAt: string
  completedAt: string
}

export interface FileChange {
  relativePath: string
  changeType: 'Added' | 'Modified' | 'Deleted'
  localMeta: FileMeta | null
  remoteMeta: FileMeta | null
}

export interface FileMeta {
  relativePath: string
  sha256: string
  size: number
  modified: string
  lastSynced: string | null
}

export const getSyncConfig = () =>
  invoke<SyncConfig>('get_sync_config')

export const setSyncConfig = (config: SyncConfig) =>
  invoke<void>('set_sync_config', { config })

export const configureSync = (syncTarget: string) =>
  invoke<SyncStatus>('configure_sync', { syncTarget })

export const runSync = () =>
  invoke<SyncResult>('run_sync')

export const getSyncChanges = () =>
  invoke<FileChange[]>('get_sync_changes')

export const fullPull = () =>
  invoke<SyncResult>('full_pull')

export const getSyncStatus = () =>
  invoke<{ syncTarget: string; autoSyncEnabled: boolean; autoSyncInterval: number; pendingChanges: number; lastSync: string | null }>('get_sync_status')

// Search
export interface SearchResult {
  noteId: string
  title: string
  path: string
  snippet: string
  score: number
}

export const searchNotes = (query: string, limit?: number) =>
  invoke<SearchResult[]>('search_notes', { query, limit: limit || null })

export const initSearchIndex = () =>
  invoke<number>('init_search_index')

export const updateSearchIndexForNote = (noteId: string) =>
  invoke<void>('update_search_index_for_note', { noteId })

// Backlinks
export interface BacklinkInfo {
  noteId: string
  noteTitle: string
  notePath: string
  context: string
}

export const getBacklinks = (noteId: string) =>
  invoke<BacklinkInfo[]>('get_backlinks', { noteId })

// Error Reporting
export const reportError = (
  errorType: string,
  message: string,
  stack?: string,
  context?: string,
  source?: string
) =>
  invoke<void>('report_error', {
    errorType,
    message,
    stack: stack || null,
    context: context || null,
    source: source || null,
  })

export interface Tag {
  name: string
  color: string
  icon: string | null
  description: string
  created_at: string
}

export interface FolderMeta {
  path: string
  icon: string | null
  color: string | null
}

// ── Tag operations ──

export async function createTag(name: string, color?: string, icon?: string, description?: string): Promise<Tag> {
  return invoke('create_tag', { name, color: color || null, icon: icon || null, description: description || null })
}

export async function updateTag(name: string, color?: string, icon?: string, description?: string): Promise<Tag> {
  return invoke('update_tag', { name, color: color || null, icon: icon || null, description: description || null })
}

export async function deleteTag(name: string): Promise<void> {
  return invoke('delete_tag', { name })
}

export async function listTags(): Promise<Tag[]> {
  return invoke('list_tags')
}

export async function getNotesByTag(tagName: string): Promise<NoteMeta[]> {
  return invoke('get_notes_by_tag', { tagName })
}

export async function addTagToNote(noteId: string, tagName: string): Promise<NoteMeta> {
  return invoke('add_tag_to_note', { noteId, tagName })
}

export async function removeTagFromNote(noteId: string, tagName: string): Promise<NoteMeta> {
  return invoke('remove_tag_from_note', { noteId, tagName })
}

// ── Icon operations ──

export async function setFolderIcon(path: string, icon: string | null): Promise<void> {
  return invoke('set_folder_icon', { path, icon })
}

export async function getFolderIcon(path: string): Promise<string | null> {
  return invoke('get_folder_icon', { path })
}

export async function listFolderIcons(): Promise<FolderMeta[]> {
  return invoke('list_folder_icons')
}

export async function setNoteIcon(noteId: string, icon: string | null): Promise<void> {
  return invoke('set_note_icon', { noteId, icon })
}

export async function getNoteIcon(noteId: string): Promise<string | null> {
  return invoke('get_note_icon', { noteId })
}
