import { useState, useRef, useEffect, useCallback } from 'react'
import type { UnlistenFn } from '@tauri-apps/api/event'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as api from '../../ipc/tauri'
import ConfirmDialog from '../ConfirmDialog'
import { useI18n } from '../../i18n'

// pdfjs-dist is loaded dynamically in handlePdfUpload to avoid
// the top-level await in pdf.mjs from crashing the app at startup.

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface OpenNote {
  id: string
  title: string
  content: string
  isActive: boolean
}

interface AIPanelProps {
  isOpen: boolean
  onClose: () => void
  currentNoteId?: string | null
  currentNoteContent: string
  currentNoteTitle: string
  openNotes: OpenNote[]
  prefillText?: string
  onWriteToNote?: (noteId: string, content: string) => void
  onCreateNoteFromAI?: (title: string, content: string) => void
  onToast?: (message: string, type: 'success' | 'error') => void
}

const MIN_WIDTH = 320
const MAX_WIDTH = 800
// Approximate chars per token (conservative estimate for mixed CJK/English)
const CHARS_PER_TOKEN = 2.5
const MAX_CONTEXT_TOKENS = 12000

export default function AIPanel({ isOpen, onClose, currentNoteId, currentNoteContent, currentNoteTitle, openNotes, prefillText, onWriteToNote, onCreateNoteFromAI, onToast }: AIPanelProps) {
  const { t } = useI18n()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o-mini')
  const [maxTokens, setMaxTokens] = useState(MAX_CONTEXT_TOKENS)
  const [panelWidth, setPanelWidth] = useState(380)
  const [isResizing, setIsResizing] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [optimizing, setOptimizing] = useState(false)
  const [showOptimizedResult, setShowOptimizedResult] = useState(false)
  const [optimizedResult, setOptimizedResult] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [clearChatConfirm, setClearChatConfirm] = useState(false)

  // Streaming state
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const streamAbortRef = useRef<UnlistenFn | null>(null)
  const streamingContentRef = useRef('')

  // PDF context state
  const [pdfFiles, setPdfFiles] = useState<Map<string, { name: string; text: string; pages: Map<number, string> }>>(new Map())
  const [pdfUploadLoading, setPdfUploadLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Per-note AI history
  const historyNoteIdRef = useRef<string | null>(null) // Which note's history is currently loaded
  const [historyCount, setHistoryCount] = useState(0) // Number of saved history entries for current note

  // History localStorage helpers
  const getHistoryKey = (noteId: string) => `ai_history_${noteId}`

  const saveHistory = useCallback((noteId: string, msgs: Message[]) => {
    if (!noteId || msgs.length === 0) return
    try {
      localStorage.setItem(getHistoryKey(noteId), JSON.stringify(msgs))
    } catch (e) {
      console.error('Failed to save AI history:', e)
    }
  }, [])

  const loadHistory = useCallback((noteId: string): Message[] => {
    if (!noteId) return []
    try {
      const data = localStorage.getItem(getHistoryKey(noteId))
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) return parsed as Message[]
      }
    } catch (e) {
      console.error('Failed to load AI history:', e)
    }
    return []
  }, [])

  const getHistoryCount = useCallback((noteId: string): number => {
    if (!noteId) return 0
    try {
      const data = localStorage.getItem(getHistoryKey(noteId))
      if (data) {
        const parsed = JSON.parse(data)
        if (Array.isArray(parsed)) return parsed.length
      }
    } catch { /* ignore */ }
    return 0
  }, [])

  // Auto-select active note when openNotes changes
  useEffect(() => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev)
      // Add newly opened notes that are active
      for (const note of openNotes) {
        if (note.isActive) next.add(note.id)
      }
      // Remove notes that are no longer open
      const openIds = new Set(openNotes.map(n => n.id))
      for (const id of next) {
        if (!openIds.has(id)) next.delete(id)
      }
      return next
    })
  }, [openNotes])

  // Load AI config from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem('ai_api_key') || ''
    const savedUrl = localStorage.getItem('ai_api_url') || 'https://api.openai.com/v1'
    const savedModel = localStorage.getItem('ai_model') || 'gpt-4o-mini'
    const savedMaxTokens = localStorage.getItem('ai_max_context_tokens')
    setApiKey(savedKey)
    setApiUrl(savedUrl)
    setModel(savedModel)
    if (savedMaxTokens) setMaxTokens(Number(savedMaxTokens))
  }, [])

  // Update history count when currentNoteId changes
  useEffect(() => {
    if (currentNoteId) {
      setHistoryCount(getHistoryCount(currentNoteId))
    } else {
      setHistoryCount(0)
    }
  }, [currentNoteId, getHistoryCount])

  // Handle note switching: save old note's history, load new note's history
  useEffect(() => {
    if (!currentNoteId) return

    // If we already have messages loaded for a different note, save them first
    const prevNoteId = historyNoteIdRef.current
    if (prevNoteId && prevNoteId !== currentNoteId && messages.length > 0) {
      saveHistory(prevNoteId, messages)
    }

    // Load the new note's history
    const history = loadHistory(currentNoteId)
    if (history.length > 0) {
      setMessages(history)
    } else {
      setMessages([])
    }
    historyNoteIdRef.current = currentNoteId
    setError(null)
  }, [currentNoteId]) // Intentionally only depend on currentNoteId

  // Save current messages explicitly (called after message exchange completes)
  const handleSaveCurrentHistory = useCallback(() => {
    if (currentNoteId && messages.length > 0) {
      saveHistory(currentNoteId, messages)
      setHistoryCount(messages.length)
    }
  }, [currentNoteId, messages, saveHistory])

  // Load history for the current note (explicit user action)
  const handleLoadHistory = useCallback(() => {
    if (!currentNoteId) {
      if (onToast) onToast(t('ai.noRelatedNotes'), 'error')
      return
    }
    const history = loadHistory(currentNoteId)
    if (history.length === 0) {
      if (onToast) onToast(t('ai.noHistory'), 'success')
      return
    }
    setMessages(history)
    historyNoteIdRef.current = currentNoteId
    setError(null)
    if (onToast) onToast(t('ai.historyLoaded', { count: history.length }), 'success')
  }, [currentNoteId, loadHistory, onToast, t])

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current()
        streamAbortRef.current = null
      }
    }
  }, [])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      // 初始化时调整高度（最小3行）
      const el = inputRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.max(72, Math.min(el.scrollHeight, 360))}px`;
    }
  }, [isOpen]);

  // Prefill input when prefillText is set
  useEffect(() => {
    if (prefillText && isOpen) {
      setInput(prefillText)
      // Focus and adjust height after prefill
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const el = inputRef.current
          el.style.height = 'auto'
          el.style.height = `${Math.max(72, Math.min(el.scrollHeight, 360))}px`
        }
      })
    }
  }, [prefillText, isOpen])

  // 当输入内容变化时调整高度
  useEffect(() => {
    if (inputRef.current) {
      const el = inputRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.max(72, Math.min(el.scrollHeight, 360))}px`;
    }
  }, [input]);

  // Drag to resize
  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      setPanelWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)))
    }
    const handleMouseUp = () => setIsResizing(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  const saveConfig = useCallback(() => {
    localStorage.setItem('ai_api_key', apiKey)
    localStorage.setItem('ai_api_url', apiUrl)
    localStorage.setItem('ai_model', model)
    localStorage.setItem('ai_max_context_tokens', String(maxTokens))
    setConfigOpen(false)
  }, [apiKey, apiUrl, model, maxTokens])

  // Calculate approximate tokens for a text
  const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

  // Get selected notes with cleaned content
  const getSelectedContext = useCallback(() => {
    const selected = openNotes.filter(n => selectedNoteIds.has(n.id))
    if (selected.length === 0 && currentNoteContent) {
      // Fallback to current note
      return [{ id: 'current', title: currentNoteTitle, content: currentNoteContent }]
    }
    return selected.map(n => ({
      id: n.id,
      title: n.title,
      content: cleanContent(n.content),
    }))
  }, [openNotes, selectedNoteIds, currentNoteContent, currentNoteTitle])

  // Clean note content: remove frontmatter, normalize whitespace
  const cleanContent = (raw: string): string => {
    let content = raw
    // Remove YAML frontmatter
    if (content.startsWith('---')) {
      const end = content.indexOf('---', 3)
      if (end !== -1) {
        content = content.slice(end + 3).trim()
      }
    }
    // Normalize whitespace: collapse multiple newlines, trim lines
    content = content
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return content
  }

  // Truncate context to fit within token budget
  const buildContextWithBudget = useCallback((notes: { id: string; title: string; content: string }[]) => {
    const budget = maxTokens * CHARS_PER_TOKEN // Convert to approximate char budget
    let totalChars = 0
    const result: typeof notes = []

    // Sort: active note first, then by content length (shorter first for more coverage)
    const activeNote = notes.find(n => openNotes.find(o => o.id === n.id && o.isActive))
    const sorted = [...notes].sort((a, b) => {
      if (a.id === activeNote?.id) return -1
      if (b.id === activeNote?.id) return 1
      return a.content.length - b.content.length
    })

    for (const note of sorted) {
      const noteChars = note.title.length + note.content.length + 50 // overhead for formatting
      if (totalChars + noteChars <= budget) {
        result.push(note)
        totalChars += noteChars
      } else {
        // Try to fit a truncated version
        const remaining = budget - totalChars - note.title.length - 50
        if (remaining > 200) {
          result.push({
            ...note,
            content: note.content.slice(0, Math.floor(remaining)) + '\n\n[... truncated]',
          })
          totalChars += note.title.length + remaining + 50
        }
        break
      }
    }

    return result
  }, [maxTokens, openNotes])

  const toggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev)
      if (next.has(noteId)) {
        next.delete(noteId)
      } else {
        next.add(noteId)
      }
      return next
    })
  }

  const selectAll = () => setSelectedNoteIds(new Set(openNotes.map(n => n.id)))
  const selectNone = () => setSelectedNoteIds(new Set())
  const selectActive = () => setSelectedNoteIds(new Set(openNotes.filter(n => n.isActive).map(n => n.id)))

  const handleSend = useCallback(async () => {
    const question = input.trim()
    if (!question || loading || isStreaming) return

    if (!apiKey) {
      setError(t('ai.pleaseConfigApiKey'))
      setConfigOpen(true)
      return
    }

    const userMsg: Message = { role: 'user', content: question, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setIsStreaming(true)
    setError(null)
    setStreamingContent('')
    streamingContentRef.current = ''

    // Capture for explicit save after exchange completes
    const noteIdForSave = currentNoteId
    const messagesBeforeExchange = messages // closure snapshot (does NOT include userMsg)

    // Build context
    const rawContext = getSelectedContext()
    const contextWithBudget = buildContextWithBudget(rawContext)

    let pdfContext = ''
    if (pdfFiles.size > 0) {
      const pdfContexts: string[] = []
      pdfFiles.forEach((pdf, fileName) => {
        const maxPdfLength = 50000
        const truncatedText = pdf.text.length > maxPdfLength
          ? pdf.text.substring(0, maxPdfLength) + '\n' + t('ai.contentTruncated')
          : pdf.text
        pdfContexts.push(`\n\n[PDF文件: ${fileName}]\n${truncatedText}`)
      })
      pdfContext = pdfContexts.join('\n')
    }

    try {
      const unlisten = await api.aiChatStream(
        {
          question,
          noteContent: currentNoteContent + pdfContext,
          noteTitle: currentNoteTitle + (pdfFiles.size > 0 ? ` (${t('ai.pdfFilesIncluded', { count: pdfFiles.size })})` : ''),
          apiKey,
          apiUrl,
          model,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          contextNotes: contextWithBudget,
        },
        // onChunk
        (chunk: string) => {
          streamingContentRef.current += chunk
          setStreamingContent(streamingContentRef.current)
        },
        // onDone
        () => {
          const finalContent = streamingContentRef.current
          const assistantMsg: Message = { role: 'assistant', content: finalContent, timestamp: Date.now() }
          setMessages(prev => [...prev, assistantMsg])
          setStreamingContent('')
          streamingContentRef.current = ''
          setIsStreaming(false)
          setLoading(false)
          if (streamAbortRef.current) {
            streamAbortRef.current()
            streamAbortRef.current = null
          }
          // Explicitly save full conversation to history for this note
          if (noteIdForSave) {
            const fullMessages = [...messagesBeforeExchange, userMsg, assistantMsg]
            saveHistory(noteIdForSave, fullMessages)
            setHistoryCount(fullMessages.length)
          }
        },
        // onError
        (errMsg: string) => {
          setError(errMsg)
          // If we got partial content, still save it as a message
          const partialContent = streamingContentRef.current
          if (partialContent) {
            const assistantMsg: Message = { role: 'assistant', content: partialContent + '\n\n' + t('ai.responseInterrupted'), timestamp: Date.now() }
            setMessages(prev => [...prev, assistantMsg])
            // Also save partial conversation to history
            if (noteIdForSave) {
              const fullMessages = [...messagesBeforeExchange, userMsg, assistantMsg]
              saveHistory(noteIdForSave, fullMessages)
              setHistoryCount(fullMessages.length)
            }
          }
          setStreamingContent('')
          streamingContentRef.current = ''
          setIsStreaming(false)
          setLoading(false)
          if (streamAbortRef.current) {
            streamAbortRef.current()
            streamAbortRef.current = null
          }
        },
      )
      streamAbortRef.current = unlisten
    } catch (e) {
      setError(String(e))
      setIsStreaming(false)
      setLoading(false)
    }
  }, [input, loading, isStreaming, apiKey, apiUrl, model, currentNoteId, currentNoteContent, currentNoteTitle, messages, getSelectedContext, buildContextWithBudget, pdfFiles, saveHistory, t])

  const handleRetry = useCallback(async (msgIndex: number) => {
    const userMsg = messages[msgIndex - 1]
    if (!userMsg || userMsg.role !== 'user' || isStreaming) return

    const newMessages = messages.slice(0, msgIndex)
    setMessages(newMessages)
    setLoading(true)
    setIsStreaming(true)
    setError(null)
    setStreamingContent('')
    streamingContentRef.current = ''

    const noteIdForSave = currentNoteId
    const messagesBeforeRetry = newMessages

    const rawContext = getSelectedContext()
    const contextWithBudget = buildContextWithBudget(rawContext)

    let pdfContext = ''
    if (pdfFiles.size > 0) {
      const pdfContexts: string[] = []
      pdfFiles.forEach((pdf, fileName) => {
        const maxPdfLength = 50000
        const truncatedText = pdf.text.length > maxPdfLength
          ? pdf.text.substring(0, maxPdfLength) + '\n' + t('ai.contentTruncated')
          : pdf.text
        pdfContexts.push(`\n\n[PDF文件: ${fileName}]\n${truncatedText}`)
      })
      pdfContext = pdfContexts.join('\n')
    }

    try {
      const unlisten = await api.aiChatStream(
        {
          question: userMsg.content,
          noteContent: currentNoteContent + pdfContext,
          noteTitle: currentNoteTitle + (pdfFiles.size > 0 ? ` (${t('ai.pdfFilesIncluded', { count: pdfFiles.size })})` : ''),
          apiKey,
          apiUrl,
          model,
          history: newMessages.map(m => ({ role: m.role, content: m.content })),
          contextNotes: contextWithBudget,
        },
        (chunk: string) => {
          streamingContentRef.current += chunk
          setStreamingContent(streamingContentRef.current)
        },
        () => {
          const finalContent = streamingContentRef.current
          const assistantMsg: Message = { role: 'assistant', content: finalContent, timestamp: Date.now() }
          setMessages(prev => [...prev, assistantMsg])
          setStreamingContent('')
          streamingContentRef.current = ''
          setIsStreaming(false)
          setLoading(false)
          if (streamAbortRef.current) {
            streamAbortRef.current()
            streamAbortRef.current = null
          }
          if (noteIdForSave) {
            const fullMessages = [...messagesBeforeRetry, userMsg, assistantMsg]
            saveHistory(noteIdForSave, fullMessages)
            setHistoryCount(fullMessages.length)
          }
        },
        (errMsg: string) => {
          setError(errMsg)
          const partialContent = streamingContentRef.current
          if (partialContent) {
            const assistantMsg: Message = { role: 'assistant', content: partialContent + '\n\n' + t('ai.responseInterrupted'), timestamp: Date.now() }
            setMessages(prev => [...prev, assistantMsg])
            if (noteIdForSave) {
              const fullMessages = [...messagesBeforeRetry, userMsg, assistantMsg]
              saveHistory(noteIdForSave, fullMessages)
              setHistoryCount(fullMessages.length)
            }
          }
          setStreamingContent('')
          streamingContentRef.current = ''
          setIsStreaming(false)
          setLoading(false)
          if (streamAbortRef.current) {
            streamAbortRef.current()
            streamAbortRef.current = null
          }
        },
      )
      streamAbortRef.current = unlisten
    } catch (e) {
      setError(String(e))
      setIsStreaming(false)
      setLoading(false)
    }
  }, [messages, isStreaming, apiKey, apiUrl, model, currentNoteId, currentNoteContent, currentNoteTitle, getSelectedContext, buildContextWithBudget, pdfFiles, saveHistory, t])

  const handleCopy = useCallback(async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    }
  }, [])

  const handleWriteToNote = useCallback((content: string) => {
    const now = new Date()
    const timeStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    const appendContent = `\n\n---\n${t('ai.writeTime', { time: timeStr })}\n\n${content}`

    // Find active note
    const activeNote = openNotes.find(n => n.isActive)
    if (activeNote) {
      if (onWriteToNote) {
        onWriteToNote(activeNote.id, appendContent)
        if (onToast) onToast(t('ai.writeSuccess'), 'success')
      }
    } else {
      // No active note, create a new one
      if (onCreateNoteFromAI) {
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
        const title = t('ai.historyNoteTitle', { date: dateStr })
        onCreateNoteFromAI(title, appendContent.trim())
        if (onToast) onToast(t('ai.writeSuccess'), 'success')
      }
    }
  }, [openNotes, onWriteToNote, onCreateNoteFromAI, onToast, t])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    if (messages.length === 0) {
      setMessages([])
      setError(null)
      return
    }
    setClearChatConfirm(true)
  }

  const confirmClearChat = () => {
    // Save current messages before clearing (so history is preserved)
    if (currentNoteId && messages.length > 0) {
      saveHistory(currentNoteId, messages)
    }
    setMessages([])
    setError(null)
    setClearChatConfirm(false)
    setPdfFiles(new Map())
  }

  // PDF upload and text extraction (pdfjs-dist loaded dynamically)
  const handlePdfUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setPdfUploadLoading(true)
    const newPdfFiles = new Map(pdfFiles)

    try {
      // Dynamic import to avoid top-level await crash
      const pdfjsLib = await import('pdfjs-dist')
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).toString()
      } catch {
        pdfjsLib.GlobalWorkerOptions.workerSrc = ''
      }

      for (const file of Array.from(files)) {
        try {
          const arrayBuffer = await file.arrayBuffer()
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const pages = new Map<number, string>()
        let fullText = ''

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map((item: any) => item.str).join(' ')
          pages.set(i, pageText)
          fullText += `\n[${t('ai.pageLabel', { num: i })}]\n${pageText}`
        }

        newPdfFiles.set(file.name, {
          name: file.name,
          text: fullText.trim(),
          pages
        })
      } catch (err) {
        console.error(`Failed to parse PDF ${file.name}:`, err)
      }
    }
    } catch (err) {
      console.error('Failed to load pdfjs-dist:', err)
    }

    setPdfFiles(newPdfFiles)
    setPdfUploadLoading(false)
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [pdfFiles, t])

  // Remove PDF from context
  const removePdf = useCallback((fileName: string) => {
    setPdfFiles(prev => {
      const next = new Map(prev)
      next.delete(fileName)
      return next
    })
  }, [])

  const handleOptimizePrompt = useCallback(async () => {
    const rawPrompt = input.trim()
    if (!rawPrompt) return

    if (!apiKey) {
      setError(t('ai.pleaseConfigApiKey'))
      setConfigOpen(true)
      return
    }

    setOptimizing(true)
    setShowOptimizedResult(false)
    setError(null)

    try {
      const optimizationPrompt = `请优化以下用户提示词，使其更清晰、逻辑更完整：

【原始提示词】
${rawPrompt}

【优化要求】
1. 梳理内容逻辑，使结构更清晰
2. 修正表达歧义
3. 补充必要的背景说明
4. 以结构化的分点形式输出优化结果
5. 优化后的提示词应能让大模型更精准理解需求

请直接输出优化后的提示词，分点清晰展示，每点前用数字标号。`

      const answer = await api.aiChat({
        question: optimizationPrompt,
        noteContent: '',
        noteTitle: '',
        apiKey,
        apiUrl,
        model,
        history: [],
        contextNotes: [],
      })

      setOptimizedResult(answer)
      setShowOptimizedResult(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setOptimizing(false)
    }
  }, [input, apiKey, apiUrl, model, t])

  const useOptimizedPrompt = () => {
    setInput(optimizedResult)
    setShowOptimizedResult(false)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // Context summary
  const selectedContext = getSelectedContext()
  const totalContextTokens = selectedContext.reduce((sum, n) => sum + estimateTokens(n.content), 0)

  if (!isOpen) return null

  return (
    <div
      className="flex-shrink-0 bg-base border-l border-border-muted flex flex-col h-full relative"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40 transition-colors z-10"
        onMouseDown={() => setIsResizing(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-accent">
            <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="text-sm font-semibold text-accent">{t('ai.title')}</span>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={handleLoadHistory} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-blue relative" title={t('ai.historyCount', { count: historyCount })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            {historyCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-blue text-text-inverse text-[9px] font-bold leading-none px-0.5">
                {historyCount > 99 ? '99+' : historyCount}
              </span>
            )}
          </button>
          <button onClick={clearChat} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-yellow" title={t('ai.clearChat')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button onClick={() => setConfigOpen(!configOpen)} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-blue" title={t('ai.settings')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-red" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Config panel */}
      {configOpen && (
        <div className="px-3 py-2 border-b border-border-muted bg-surface space-y-2">
          <div>
            <label className="block text-xs text-text-secondary mb-1">{t('ai.apiBaseUrl')}</label>
            <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full px-2 py-1 text-xs bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">{t('ai.apiKey')}</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t('ai.apiKeyPlaceholder')} className="w-full px-2 py-1 text-xs bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">{t('ai.model')}</label>
            <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={t('ai.modelPlaceholder')} className="w-full px-2 py-1 text-xs bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">{t('ai.maxContextTokens')}</label>
            <input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} className="w-full px-2 py-1 text-xs bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-accent" />
          </div>
          <button onClick={saveConfig} className="w-full py-1 text-xs bg-accent text-text-inverse rounded hover:bg-lavender transition-colors">{t('ai.save')}</button>
        </div>
      )}

      {/* Context selector */}
      <div className="border-b border-border-muted">
        <button
          onClick={() => setContextOpen(!contextOpen)}
          className="w-full px-3 py-1.5 flex items-center justify-between text-xs hover:bg-surface transition-colors"
        >
          <div className="flex items-center gap-1.5 text-text-muted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span>{t('ai.contextNotes', { count: selectedNoteIds.size })}</span>
            <span className="text-text-surface">|</span>
            <span>{t('ai.tokens', { count: totalContextTokens.toLocaleString() })}</span>
          </div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${contextOpen ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {contextOpen && (
          <div className="px-3 pb-2 space-y-1">
            <div className="flex gap-1 mb-1">
              <button onClick={selectAll} className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-text-secondary hover:text-text-primary">{t('ai.all')}</button>
              <button onClick={selectNone} className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-text-secondary hover:text-text-primary">{t('ai.none')}</button>
              <button onClick={selectActive} className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-text-secondary hover:text-text-primary">{t('ai.active')}</button>
            </div>
            {openNotes.length === 0 ? (
              <div className="text-[10px] text-text-muted py-1">{t('ai.noOpenNotes')}</div>
            ) : (
              openNotes.map(note => (
                <label key={note.id} className="flex items-center gap-2 py-0.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedNoteIds.has(note.id)}
                    onChange={() => toggleNoteSelection(note.id)}
                    className="accent-accent w-3 h-3"
                  />
                  <span className={`text-[11px] truncate ${note.isActive ? 'text-accent' : 'text-text-secondary'} group-hover:text-text-primary`}>
                    {note.title}
                    {note.isActive && <span className="ml-1 text-[9px] text-text-muted">{t('ai.activeLabel')}</span>}
                  </span>
                  <span className="text-[9px] text-text-surface ml-auto flex-shrink-0">
                    ~{estimateTokens(note.content).toLocaleString()}t
                  </span>
                </label>
              ))
            )}
            {totalContextTokens > maxTokens && (
              <div className="text-[10px] text-yellow mt-1">
                {t('ai.contextExceeds', { limit: maxTokens.toLocaleString() })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
              <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p className="text-sm">{t('ai.askHint')}</p>
            <p className="text-xs mt-1">{t('ai.selectNotesHint')}</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-full rounded-lg text-sm ${
              msg.role === 'user'
                ? 'bg-accent text-text-inverse px-3 py-2'
                : 'bg-muted text-text-primary px-3 py-2 w-full'
            }`}>
              {msg.role === 'user' ? (
                <>
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  <div className="text-[10px] mt-1 text-text-inverse/50">
                    {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </>
              ) : (
                <>
                  <div className="ai-markdown-content break-words overflow-hidden">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children, ...props }) => (
                          <pre className="bg-surface rounded-md p-2 my-2 overflow-x-auto text-xs" {...props}>{children}</pre>
                        ),
                        code: ({ className, children, ...props }) => {
                          const isInline = !className
                          if (isInline) return <code className="bg-hover px-1 py-0.5 rounded text-yellow text-xs" {...props}>{children}</code>
                          return <code className={className} {...props}>{children}</code>
                        },
                        p: ({ children, ...props }) => <p className="mb-2 last:mb-0" {...props}>{children}</p>,
                        ul: ({ children, ...props }) => <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>,
                        ol: ({ children, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props}>{children}</ol>,
                        li: ({ children, ...props }) => <li className="mb-0.5" {...props}>{children}</li>,
                        h1: ({ children, ...props }) => <h1 className="text-base font-bold mb-2 text-accent" {...props}>{children}</h1>,
                        h2: ({ children, ...props }) => <h2 className="text-sm font-bold mb-2 text-accent" {...props}>{children}</h2>,
                        h3: ({ children, ...props }) => <h3 className="text-sm font-semibold mb-1 text-accent" {...props}>{children}</h3>,
                        blockquote: ({ children, ...props }) => (
                          <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary" {...props}>{children}</blockquote>
                        ),
                        a: ({ children, ...props }) => <a className="text-blue underline" {...props}>{children}</a>,
                        table: ({ children, ...props }) => <table className="border-collapse my-2 text-xs w-full" {...props}>{children}</table>,
                        th: ({ children, ...props }) => <th className="border border-border-hover px-2 py-1 bg-surface text-left" {...props}>{children}</th>,
                        td: ({ children, ...props }) => <td className="border border-border-hover px-2 py-1" {...props}>{children}</td>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-hover/50">
                    <span className="text-[10px] text-text-muted">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleCopy(msg.content, i)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                        title={t('ai.copy')}
                      >
                        {copiedIdx === i ? (
                          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>{t('ai.copied')}</>
                        ) : (
                          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>{t('ai.copy')}</>
                        )}
                      </button>
                      <button
                        onClick={() => handleRetry(i)}
                        disabled={loading}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary transition-colors disabled:opacity-50"
                        title={t('ai.retry')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                        </svg>
                        {t('ai.retry')}
                      </button>
                      <button
                        onClick={() => handleWriteToNote(msg.content)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-secondary hover:bg-hover hover:text-green transition-colors"
                        title={t('ai.writeToNote')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14,2 14,8 20,8" />
                          <line x1="12" y1="18" x2="12" y2="12" />
                          <polyline points="9,15 12,12 15,15" />
                        </svg>
                        {t('ai.writeToNote')}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {loading && isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm text-text-primary w-full">
              <div className="ai-markdown-content break-words overflow-hidden">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: ({ children, ...props }) => (
                      <pre className="bg-surface rounded-md p-2 my-2 overflow-x-auto text-xs" {...props}>{children}</pre>
                    ),
                    code: ({ className, children, ...props }) => {
                      const isInline = !className
                      if (isInline) return <code className="bg-hover px-1 py-0.5 rounded text-yellow text-xs" {...props}>{children}</code>
                      return <code className={className} {...props}>{children}</code>
                    },
                    p: ({ children, ...props }) => <p className="mb-2 last:mb-0" {...props}>{children}</p>,
                    ul: ({ children, ...props }) => <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>,
                    ol: ({ children, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props}>{children}</ol>,
                    li: ({ children, ...props }) => <li className="mb-0.5" {...props}>{children}</li>,
                    h1: ({ children, ...props }) => <h1 className="text-base font-bold mb-2 text-accent" {...props}>{children}</h1>,
                    h2: ({ children, ...props }) => <h2 className="text-sm font-bold mb-2 text-accent" {...props}>{children}</h2>,
                    h3: ({ children, ...props }) => <h3 className="text-sm font-semibold mb-1 text-accent" {...props}>{children}</h3>,
                    blockquote: ({ children, ...props }) => (
                      <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary" {...props}>{children}</blockquote>
                    ),
                    a: ({ children, ...props }) => <a className="text-blue underline" {...props}>{children}</a>,
                    table: ({ children, ...props }) => <table className="border-collapse my-2 text-xs w-full" {...props}>{children}</table>,
                    th: ({ children, ...props }) => <th className="border border-border-hover px-2 py-1 bg-surface text-left" {...props}>{children}</th>,
                    td: ({ children, ...props }) => <td className="border border-border-hover px-2 py-1" {...props}>{children}</td>,
                  }}
                >
                  {streamingContent}
                </ReactMarkdown>
              </div>
              <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-hover/50">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                <span className="text-[10px] text-text-muted">{t('ai.generating')}</span>
              </div>
            </div>
          </div>
        )}

        {loading && (!isStreaming || !streamingContent) && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm text-text-secondary">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red/10 border border-red/30 rounded-lg px-3 py-2 text-xs text-red">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Optimized result */}
      {showOptimizedResult && (
        <div className="px-3 py-2 border-t border-border-muted bg-surface">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-accent">{t('ai.optimizedPrompt')}</span>
            <div className="flex gap-1">
              <button
                onClick={useOptimizedPrompt}
                className="px-2 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-lavender transition-colors"
              >
                {t('ai.useThisPrompt')}
              </button>
              <button
                onClick={() => setShowOptimizedResult(false)}
                className="px-2 py-1 text-xs bg-muted text-text-secondary rounded hover:bg-hover transition-colors"
              >
                {t('ai.close')}
              </button>
            </div>
          </div>
          <div className="ai-markdown-content text-sm bg-muted rounded-lg px-3 py-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children, ...props }) => (
                  <pre className="bg-surface rounded-md p-2 my-2 overflow-x-auto text-xs" {...props}>{children}</pre>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  if (isInline) return <code className="bg-hover px-1 py-0.5 rounded text-yellow text-xs" {...props}>{children}</code>
                  return <code className={className} {...props}>{children}</code>
                },
                p: ({ children, ...props }) => <p className="mb-2 last:mb-0" {...props}>{children}</p>,
                ul: ({ children, ...props }) => <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>,
                ol: ({ children, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props}>{children}</ol>,
                li: ({ children, ...props }) => <li className="mb-0.5" {...props}>{children}</li>,
              }}
            >
              {optimizedResult}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* PDF Files Context */}
      {pdfFiles.size > 0 && (
        <div className="px-3 py-2 border-t border-border-muted bg-surface">
          <div className="text-xs text-text-muted mb-1">{t('ai.pdfContext')}</div>
          <div className="flex flex-wrap gap-1">
            {Array.from(pdfFiles.entries()).map(([fileName, pdf]) => (
              <div key={fileName} className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-xs">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
                <span className="text-text-primary">{fileName}</span>
                <span className="text-text-muted">({t('ai.pdfPages', { count: pdf.pages.size })})</span>
                <button
                  onClick={() => removePdf(fileName)}
                  className="ml-1 text-text-muted hover:text-red"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-border-muted">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // 实时调整高度
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.max(72, Math.min(el.scrollHeight, 360))}px`; // 最小3行(72px)，最大15行(360px)
              }}
              onKeyDown={handleKeyDown}
              placeholder={t('ai.inputPlaceholder')}
              className="w-full px-3 py-2 pr-10 text-sm bg-muted border border-border-hover rounded-lg text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent overflow-y-auto"
              style={{
                height: '72px', // 默认3行高度
                minHeight: '72px', // 最小3行
                maxHeight: '360px', // 最大15行
              }}
              disabled={loading || optimizing}
            />
            {/* PDF upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={pdfUploadLoading}
              className="absolute bottom-2 right-2 p-1.5 text-text-muted hover:text-blue hover:bg-hover rounded transition-colors"
              title={t('ai.uploadPdf')}
            >
              {pdfUploadLoading ? (
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9,15 12,12 15,15" />
                </svg>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              onChange={handlePdfUpload}
              className="hidden"
            />
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={handleOptimizePrompt}
              disabled={loading || optimizing || !input.trim()}
              className="px-2 py-1 text-xs bg-muted text-text-secondary rounded hover:bg-hover hover:text-yellow transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title={t('ai.optimizePrompt')}
            >
              {optimizing ? (
                <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>{t('ai.optimizing')}</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>{t('ai.optimize')}</>
              )}
            </button>
            {isStreaming ? (
              <button
                onClick={() => {
                  // Stop streaming: save partial content and cleanup
                  const partialContent = streamingContentRef.current
                  if (partialContent) {
                    const assistantMsg: Message = { role: 'assistant', content: partialContent, timestamp: Date.now() }
                    setMessages(prev => [...prev, assistantMsg])
                  }
                  setStreamingContent('')
                  streamingContentRef.current = ''
                  setIsStreaming(false)
                  setLoading(false)
                  if (streamAbortRef.current) {
                    streamAbortRef.current()
                    streamAbortRef.current = null
                  }
                }}
                className="self-end px-3 py-1.5 bg-red text-text-inverse rounded hover:bg-red/80 transition-colors"
                title={t('ai.stopGenerating')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={loading || optimizing || !input.trim()}
                className="self-end px-3 py-1.5 bg-accent text-text-inverse rounded hover:bg-lavender transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="text-[10px] text-text-muted mt-1">
          {t('ai.inputHint')}
        </div>
      </div>

      {/* Confirm Dialog for clearing chat */}
      <ConfirmDialog
        isOpen={clearChatConfirm}
        title={t('ai.clearChatTitle')}
        message={t('ai.clearChatConfirm')}
        confirmLabel={t('ai.clearChatConfirmBtn')}
        variant="warning"
        onConfirm={confirmClearChat}
        onCancel={() => setClearChatConfirm(false)}
      />
    </div>
  )
}
