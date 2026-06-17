import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as api from '../../ipc/tauri'

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
  currentNoteContent: string
  currentNoteTitle: string
  openNotes: OpenNote[]
}

const MIN_WIDTH = 320
const MAX_WIDTH = 800
// Approximate chars per token (conservative estimate for mixed CJK/English)
const CHARS_PER_TOKEN = 2.5
const MAX_CONTEXT_TOKENS = 12000

export default function AIPanel({ isOpen, onClose, currentNoteContent, currentNoteTitle, openNotes }: AIPanelProps) {
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

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      // 初始化时调整高度
      const el = inputRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
    }
  }, [isOpen]);

  // 当输入内容变化时调整高度
  useEffect(() => {
    if (inputRef.current) {
      const el = inputRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
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
    if (!question || loading) return

    if (!apiKey) {
      setError('请先配置 API Key')
      setConfigOpen(true)
      return
    }

    const userMsg: Message = { role: 'user', content: question, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      // Build multi-note context
      const rawContext = getSelectedContext()
      const contextWithBudget = buildContextWithBudget(rawContext)

      const answer = await api.aiChat({
        question,
        noteContent: currentNoteContent,
        noteTitle: currentNoteTitle,
        apiKey,
        apiUrl,
        model,
        history: messages.map(m => ({ role: m.role, content: m.content })),
        contextNotes: contextWithBudget,
      })

      const assistantMsg: Message = { role: 'assistant', content: answer, timestamp: Date.now() }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [input, loading, apiKey, apiUrl, model, currentNoteContent, currentNoteTitle, messages, getSelectedContext, buildContextWithBudget])

  const handleRetry = useCallback(async (msgIndex: number) => {
    const userMsg = messages[msgIndex - 1]
    if (!userMsg || userMsg.role !== 'user') return

    const newMessages = messages.slice(0, msgIndex)
    setMessages(newMessages)
    setLoading(true)
    setError(null)

    try {
      const rawContext = getSelectedContext()
      const contextWithBudget = buildContextWithBudget(rawContext)

      const answer = await api.aiChat({
        question: userMsg.content,
        noteContent: currentNoteContent,
        noteTitle: currentNoteTitle,
        apiKey,
        apiUrl,
        model,
        history: newMessages.map(m => ({ role: m.role, content: m.content })),
        contextNotes: contextWithBudget,
      })

      const assistantMsg: Message = { role: 'assistant', content: answer, timestamp: Date.now() }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [messages, apiKey, apiUrl, model, currentNoteContent, currentNoteTitle, getSelectedContext, buildContextWithBudget])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setMessages([])
    setError(null)
  }

  const handleOptimizePrompt = useCallback(async () => {
    const rawPrompt = input.trim()
    if (!rawPrompt) return

    if (!apiKey) {
      setError('请先配置 API Key')
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
  }, [input, apiKey, apiUrl, model])

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
      className="flex-shrink-0 bg-[#1e1e2e] border-l border-[#313244] flex flex-col h-full relative"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#cba6f7]/40 transition-colors z-10"
        onMouseDown={() => setIsResizing(true)}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cba6f7" strokeWidth="2" className="flex-shrink-0">
            <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <span className="text-sm font-semibold text-[#cba6f7]">AI Assistant</span>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={clearChat} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#f9e2af]" title="Clear chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button onClick={() => setConfigOpen(!configOpen)} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#89b4fa]" title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#313244] text-[#a6adc8] hover:text-[#f38ba8]" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Config panel */}
      {configOpen && (
        <div className="px-3 py-2 border-b border-[#313244] bg-[#181825] space-y-2">
          <div>
            <label className="block text-xs text-[#a6adc8] mb-1">API Base URL</label>
            <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="w-full px-2 py-1 text-xs bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]" />
          </div>
          <div>
            <label className="block text-xs text-[#a6adc8] mb-1">API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." className="w-full px-2 py-1 text-xs bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]" />
          </div>
          <div>
            <label className="block text-xs text-[#a6adc8] mb-1">Model</label>
            <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini" className="w-full px-2 py-1 text-xs bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]" />
          </div>
          <div>
            <label className="block text-xs text-[#a6adc8] mb-1">Max Context Tokens</label>
            <input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} className="w-full px-2 py-1 text-xs bg-[#313244] border border-[#45475a] rounded text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]" />
          </div>
          <button onClick={saveConfig} className="w-full py-1 text-xs bg-[#cba6f7] text-[#1e1e2e] rounded hover:bg-[#b4befe] transition-colors">Save</button>
        </div>
      )}

      {/* Context selector */}
      <div className="border-b border-[#313244]">
        <button
          onClick={() => setContextOpen(!contextOpen)}
          className="w-full px-3 py-1.5 flex items-center justify-between text-xs hover:bg-[#181825] transition-colors"
        >
          <div className="flex items-center gap-1.5 text-[#6c7086]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span>Context: {selectedNoteIds.size} notes</span>
            <span className="text-[#45475a]">|</span>
            <span>~{totalContextTokens.toLocaleString()} tokens</span>
          </div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${contextOpen ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {contextOpen && (
          <div className="px-3 pb-2 space-y-1">
            <div className="flex gap-1 mb-1">
              <button onClick={selectAll} className="px-1.5 py-0.5 text-[10px] rounded bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4]">All</button>
              <button onClick={selectNone} className="px-1.5 py-0.5 text-[10px] rounded bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4]">None</button>
              <button onClick={selectActive} className="px-1.5 py-0.5 text-[10px] rounded bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4]">Active</button>
            </div>
            {openNotes.length === 0 ? (
              <div className="text-[10px] text-[#6c7086] py-1">No open notes</div>
            ) : (
              openNotes.map(note => (
                <label key={note.id} className="flex items-center gap-2 py-0.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedNoteIds.has(note.id)}
                    onChange={() => toggleNoteSelection(note.id)}
                    className="accent-[#cba6f7] w-3 h-3"
                  />
                  <span className={`text-[11px] truncate ${note.isActive ? 'text-[#cba6f7]' : 'text-[#a6adc8]'} group-hover:text-[#cdd6f4]`}>
                    {note.title}
                    {note.isActive && <span className="ml-1 text-[9px] text-[#6c7086]">(active)</span>}
                  </span>
                  <span className="text-[9px] text-[#45475a] ml-auto flex-shrink-0">
                    ~{estimateTokens(note.content).toLocaleString()}t
                  </span>
                </label>
              ))
            )}
            {totalContextTokens > maxTokens && (
              <div className="text-[10px] text-[#f9e2af] mt-1">
                Context exceeds limit ({maxTokens.toLocaleString()}t). Content will be auto-truncated.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[#6c7086]">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
              <path d="M12 2a7 7 0 017 7v1a7 7 0 01-14 0V9a7 7 0 017-7z" />
              <path d="M8 21h8M12 17v4" />
            </svg>
            <p className="text-sm">Ask a question about your notes</p>
            <p className="text-xs mt-1">Select notes from the context panel above</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-full rounded-lg text-sm ${
              msg.role === 'user'
                ? 'bg-[#cba6f7] text-[#1e1e2e] px-3 py-2'
                : 'bg-[#313244] text-[#cdd6f4] px-3 py-2 w-full'
            }`}>
              {msg.role === 'user' ? (
                <>
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  <div className="text-[10px] mt-1 text-[#1e1e2e]/50">
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
                          <pre className="bg-[#181825] rounded-md p-2 my-2 overflow-x-auto text-xs" {...props}>{children}</pre>
                        ),
                        code: ({ className, children, ...props }) => {
                          const isInline = !className
                          if (isInline) return <code className="bg-[#45475a] px-1 py-0.5 rounded text-[#f9e2af] text-xs" {...props}>{children}</code>
                          return <code className={className} {...props}>{children}</code>
                        },
                        p: ({ children, ...props }) => <p className="mb-2 last:mb-0" {...props}>{children}</p>,
                        ul: ({ children, ...props }) => <ul className="list-disc pl-4 mb-2" {...props}>{children}</ul>,
                        ol: ({ children, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props}>{children}</ol>,
                        li: ({ children, ...props }) => <li className="mb-0.5" {...props}>{children}</li>,
                        h1: ({ children, ...props }) => <h1 className="text-base font-bold mb-2 text-[#cba6f7]" {...props}>{children}</h1>,
                        h2: ({ children, ...props }) => <h2 className="text-sm font-bold mb-2 text-[#cba6f7]" {...props}>{children}</h2>,
                        h3: ({ children, ...props }) => <h3 className="text-sm font-semibold mb-1 text-[#cba6f7]" {...props}>{children}</h3>,
                        blockquote: ({ children, ...props }) => (
                          <blockquote className="border-l-2 border-[#cba6f7] pl-3 my-2 text-[#a6adc8]" {...props}>{children}</blockquote>
                        ),
                        a: ({ children, ...props }) => <a className="text-[#89b4fa] underline" {...props}>{children}</a>,
                        table: ({ children, ...props }) => <table className="border-collapse my-2 text-xs w-full" {...props}>{children}</table>,
                        th: ({ children, ...props }) => <th className="border border-[#45475a] px-2 py-1 bg-[#181825] text-left" {...props}>{children}</th>,
                        td: ({ children, ...props }) => <td className="border border-[#45475a] px-2 py-1" {...props}>{children}</td>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-[#45475a]/50">
                    <span className="text-[10px] text-[#6c7086]">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleCopy(msg.content, i)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[#a6adc8] hover:bg-[#45475a] hover:text-[#cdd6f4] transition-colors"
                        title="Copy"
                      >
                        {copiedIdx === i ? (
                          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>Copied</>
                        ) : (
                          <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>Copy</>
                        )}
                      </button>
                      <button
                        onClick={() => handleRetry(i)}
                        disabled={loading}
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[#a6adc8] hover:bg-[#45475a] hover:text-[#cdd6f4] transition-colors disabled:opacity-50"
                        title="Retry"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                        </svg>
                        Retry
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#313244] rounded-lg px-3 py-2 text-sm text-[#a6adc8]">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-[#f38ba8]/10 border border-[#f38ba8]/30 rounded-lg px-3 py-2 text-xs text-[#f38ba8]">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Optimized result */}
      {showOptimizedResult && (
        <div className="px-3 py-2 border-t border-[#313244] bg-[#181825]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#cba6f7]">✨ 优化后的提示词</span>
            <div className="flex gap-1">
              <button
                onClick={useOptimizedPrompt}
                className="px-2 py-1 text-xs bg-[#cba6f7] text-[#1e1e2e] rounded hover:bg-[#b4befe] transition-colors"
              >
                使用此提示词
              </button>
              <button
                onClick={() => setShowOptimizedResult(false)}
                className="px-2 py-1 text-xs bg-[#313244] text-[#a6adc8] rounded hover:bg-[#45475a] transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="ai-markdown-content text-sm bg-[#313244] rounded-lg px-3 py-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children, ...props }) => (
                  <pre className="bg-[#181825] rounded-md p-2 my-2 overflow-x-auto text-xs" {...props}>{children}</pre>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  if (isInline) return <code className="bg-[#45475a] px-1 py-0.5 rounded text-[#f9e2af] text-xs" {...props}>{children}</code>
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

      {/* Input */}
      <div className="px-3 py-2 border-t border-[#313244]">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // 实时调整高度
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`; // 假设24px行高，15行=360px
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your notes..."
            className="flex-1 px-3 py-2 text-sm bg-[#313244] border border-[#45475a] rounded-lg text-[#cdd6f4] placeholder-[#6c7086] resize-none focus:outline-none focus:border-[#cba6f7] overflow-y-auto"
            style={{
              height: 'auto',
              maxHeight: '360px', // 15行，约24px行高
            }}
            disabled={loading || optimizing}
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={handleOptimizePrompt}
              disabled={loading || optimizing || !input.trim()}
              className="px-2 py-1 text-xs bg-[#313244] text-[#a6adc8] rounded hover:bg-[#45475a] hover:text-[#f9e2af] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              title="优化提示词"
            >
              {optimizing ? (
                <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>优化中</>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>优化</>
              )}
            </button>
            <button
              onClick={handleSend}
              disabled={loading || optimizing || !input.trim()}
              className="self-end px-3 py-1.5 bg-[#cba6f7] text-[#1e1e2e] rounded hover:bg-[#b4befe] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="text-[10px] text-[#6c7086] mt-1">
          Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  )
}
