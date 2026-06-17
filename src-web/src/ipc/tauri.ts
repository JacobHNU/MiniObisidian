import { invoke } from '@tauri-apps/api/core'

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

// Sync
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

export const configureSync = (syncTarget: string) =>
  invoke<SyncStatus>('configure_sync', { syncTarget })

export const runSync = (syncTarget: string) =>
  invoke<SyncResult>('run_sync', { syncTarget })

export const getSyncChanges = (syncTarget: string) =>
  invoke<FileChange[]>('get_sync_changes', { syncTarget })
