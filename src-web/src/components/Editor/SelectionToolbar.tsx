import { useState, useEffect, useCallback, useRef } from 'react'

interface SelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement>
  onSendToAI: (text: string) => void
}

export default function SelectionToolbar({ containerRef, onSendToAI }: SelectionToolbarProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updateSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      // Delay hiding to allow clicking the toolbar button
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      hideTimerRef.current = setTimeout(() => {
        setPosition(null)
        setSelectedText('')
      }, 200)
      return
    }

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    const text = selection.toString().trim()
    if (!text) return

    // Check if selection is within the container
    const container = containerRef.current
    if (!container) return

    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      setPosition(null)
      setSelectedText('')
      return
    }

    const rect = range.getBoundingClientRect()
    const toolbarWidth = 100
    const toolbarHeight = 36

    let left = rect.left + rect.width / 2 - toolbarWidth / 2
    let top = rect.bottom + 8

    // Viewport overflow protection
    if (left < 8) left = 8
    if (left + toolbarWidth > window.innerWidth - 8) left = window.innerWidth - toolbarWidth - 8
    if (top + toolbarHeight > window.innerHeight - 8) {
      top = rect.top - toolbarHeight - 8
    }

    setPosition({ top, left })
    setSelectedText(text)
  }, [containerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseUp = () => {
      // Small delay to let selection finalize
      setTimeout(updateSelection, 10)
    }

    const handleScroll = () => {
      setPosition(null)
      setSelectedText('')
    }

    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('scroll', handleScroll, true)
    document.addEventListener('selectionchange', updateSelection)

    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('selectionchange', updateSelection)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [containerRef, updateSelection])

  const handleClick = useCallback(() => {
    if (selectedText) {
      onSendToAI(selectedText)
      // Clear selection after sending
      window.getSelection()?.removeAllRanges()
      setPosition(null)
      setSelectedText('')
    }
  }, [selectedText, onSendToAI])

  if (!position || !selectedText) return null

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[150] animate-fade-in"
      style={{
        top: position.top,
        left: position.left,
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <button
        onClick={handleClick}
        onMouseDown={(e) => e.preventDefault()} // Prevent losing selection
        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#313244] border border-[#45475a] rounded-lg text-[#cdd6f4] text-xs font-medium shadow-lg hover:bg-[#45475a] hover:border-[#cba6f7] transition-all"
        title="发送到 AI 问答"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cba6f7" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>AI问答</span>
      </button>
    </div>
  )
}
