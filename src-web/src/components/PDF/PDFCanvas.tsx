import { useState, useEffect, useRef, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

// Cache the resolved worker URL so we only compute it once
let cachedWorkerUrl: string | null = null

async function getWorkerUrl(): Promise<string> {
  if (cachedWorkerUrl !== null) return cachedWorkerUrl
  try {
    const mod = await import('pdfjs-dist/build/pdf.worker.mjs?url')
    cachedWorkerUrl = (mod as { default: string }).default
  } catch {
    cachedWorkerUrl = ''
  }
  return cachedWorkerUrl
}

async function loadPdfjsLib() {
  const lib = await import('pdfjs-dist')
  const workerUrl = await getWorkerUrl()
  lib.GlobalWorkerOptions.workerSrc = workerUrl
  return lib
}

interface PDFCanvasProps {
  base64Data: string  // raw base64, no data: prefix
  onSendToAI?: (text: string) => void
  onToast?: (message: string, type: 'success' | 'error') => void
}

export default function PDFCanvas({ base64Data, onSendToAI, onToast }: PDFCanvasProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const renderedPagesRef = useRef<Set<string>>(new Set())
  const renderedTextLayersRef = useRef<Set<string>>(new Set())
  const textLayerTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map())
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const scaleRef = useRef<number>(scale)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { pdfRef.current = pdf }, [pdf])
  useEffect(() => { scaleRef.current = scale }, [scale])

  // Load PDF using dynamic import
  useEffect(() => {
    if (!base64Data) return

    let cancelled = false

    const loadPdf = async () => {
      const startTime = performance.now()
      try {
        setLoading(true)
        setError(null)

        let cleanBase64 = base64Data.trim()
        const commaIdx = cleanBase64.indexOf(',')
        if (cleanBase64.startsWith('data:') && commaIdx !== -1) {
          cleanBase64 = cleanBase64.slice(commaIdx + 1)
        }
        cleanBase64 = cleanBase64.replace(/\s+/g, '')

        const binaryStr = atob(cleanBase64)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }

        if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
          throw new Error('无效的 PDF 文件结构（文件头不匹配 %PDF-）')
        }

        const pdfjsLib = await loadPdfjsLib()
        if (cancelled) return

        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise
        if (cancelled) { pdfDoc.destroy(); return }

        const elapsed = performance.now() - startTime
        console.log(`[PDF] Loaded ${pdfDoc.numPages} pages in ${elapsed.toFixed(0)}ms, worker: ${cachedWorkerUrl ? 'yes' : 'no-worker'}`)

        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        const elapsed = performance.now() - startTime
        console.error(`[PDF] Load failed after ${elapsed.toFixed(0)}ms:`, err)
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('atob') || msg.includes('invalid character')) {
          setError('PDF 加载失败: 文件数据编码异常，请尝试重新导入该 PDF 文件。')
        } else {
          setError('PDF 加载失败: ' + msg)
        }
        setLoading(false)
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [base64Data])

  // Render canvas for a specific page
  const renderPage = useCallback(async (pageNum: number) => {
    const currentPdf = pdfRef.current
    if (!currentPdf || renderedPagesRef.current.has(`${pageNum}-${scaleRef.current}`)) return
    const canvas = canvasRefs.current.get(pageNum)
    if (!canvas) return

    try {
      const page = await currentPdf.getPage(pageNum)
      const currentScale = scaleRef.current
      const viewport = page.getViewport({ scale: currentScale })
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: context, viewport }).promise
      renderedPagesRef.current.add(`${pageNum}-${currentScale}`)
    } catch (err) {
      console.error(`[PDF] Failed to render page ${pageNum}:`, err)
    }
  }, [])

  // Render text layer for a specific page (enables text selection)
  const renderTextLayer = useCallback(async (pageNum: number) => {
    const currentPdf = pdfRef.current
    const currentScale = scaleRef.current
    const cacheKey = `${pageNum}-${currentScale}`
    if (!currentPdf || renderedTextLayersRef.current.has(cacheKey)) return

    const textLayerDiv = textLayerRefs.current.get(pageNum)
    if (!textLayerDiv) return

    // Cancel any previous text layer task for this page
    const prevTask = textLayerTasksRef.current.get(pageNum)
    if (prevTask) {
      prevTask.cancel()
      textLayerTasksRef.current.delete(pageNum)
    }

    // Clear existing content
    textLayerDiv.innerHTML = ''

    try {
      const page = await currentPdf.getPage(pageNum)
      const viewport = page.getViewport({ scale: currentScale })
      const textContent = await page.getTextContent()

      // Set container size to match canvas viewport
      textLayerDiv.style.width = `${viewport.width}px`
      textLayerDiv.style.height = `${viewport.height}px`

      const pdfjsLib = await loadPdfjsLib()
      if (renderedTextLayersRef.current.has(cacheKey)) return

      const textDivs: HTMLElement[] = []
      const textDivProperties = new WeakMap()
      const textContentItemsStr: string[] = []

      const task = pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
        textDivs,
        textDivProperties,
        textContentItemsStr,
      })

      textLayerTasksRef.current.set(pageNum, task)

      await task.promise
      textLayerTasksRef.current.delete(pageNum)
      renderedTextLayersRef.current.add(cacheKey)
    } catch (err: any) {
      // renderTextLayer throws when cancelled - that's expected
      if (err?.name !== 'RenderingCancelledException') {
        console.error(`[PDF] Failed to render text layer for page ${pageNum}:`, err)
      }
    }
  }, [])

  // Intersection observer for lazy loading - scoped to container
  useEffect(() => {
    if (!pdf) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute('data-page') || '0')
            if (pageNum > 0) {
              renderPage(pageNum)
              renderTextLayer(pageNum)
            }
          }
        })
      },
      { root: containerRef.current, rootMargin: '200px' }
    )

    containerRef.current?.querySelectorAll('[data-page]').forEach(el => {
      observer.observe(el)
    })

    return () => observer.disconnect()
  }, [pdf, scale, totalPages, renderPage, renderTextLayer])

  // Clear rendered cache when scale changes so pages re-render at new zoom
  useEffect(() => {
    renderedPagesRef.current.clear()
    renderedTextLayersRef.current.clear()
    // Cancel all pending text layer tasks
    textLayerTasksRef.current.forEach(task => task.cancel())
    textLayerTasksRef.current.clear()
  }, [scale])

  // Zoom controls
  const zoomIn = () => setScale(prev => Math.min(prev + 0.2, 3.0))
  const zoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.5))
  const resetZoom = () => setScale(1.2)

  // Right-click context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() || ''
    if (!selectedText) {
      setContextMenu(null)
      return
    }
    e.preventDefault()
    e.stopPropagation()

    // Calculate position ensuring menu stays within viewport
    const menuWidth = 180
    const menuHeight = 88
    const padding = 8
    let x = e.clientX
    let y = e.clientY
    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding
    }

    setContextMenu({ x, y, text: selectedText })
  }, [])

  // Close context menu on click outside or scroll
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('click', close)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  // Copy selected text to clipboard
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast?.('已复制到剪贴板', 'success')
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      onToast?.('已复制到剪贴板', 'success')
    }
    setContextMenu(null)
  }, [onToast])

  // Send selected text to AI Q&A
  const handleSendToAI = useCallback((text: string) => {
    onSendToAI?.(text)
    setContextMenu(null)
  }, [onSendToAI])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#11111b]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#89b4fa] mx-auto mb-3"></div>
          <p className="text-[#a6adc8] text-sm">加载 PDF 中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-[#11111b]">
        <div className="text-center">
          <p className="text-[#f38ba8] mb-2">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Text layer styles - injected once */}
      <style>{`
        .pdf-text-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          opacity: 1;
          line-height: 1.0;
          -webkit-text-size-adjust: none;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          z-index: 2;
          pointer-events: auto;
        }
        .pdf-text-layer :is(span, br) {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
        .pdf-text-layer span.markedContent {
          top: 0;
          height: 0;
        }
        .pdf-text-layer .endOfContent {
          display: block;
          position: absolute;
          inset: 100% 0 0;
          z-index: -1;
          cursor: default;
          user-select: none;
        }
        .pdf-text-layer .endOfContent.active {
          top: 0;
        }
        .pdf-text-layer ::selection {
          background: rgba(0, 100, 255, 0.35);
        }
        .pdf-text-layer ::-moz-selection {
          background: rgba(0, 100, 255, 0.35);
        }
        .pdf-text-layer br::selection {
          background: transparent;
        }
        .pdf-text-layer br::-moz-selection {
          background: transparent;
        }
      `}</style>

      {/* Toolbar */}
      <div className="h-10 bg-[#181825] border-b border-[#313244] flex items-center px-4 gap-3 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f38ba8" strokeWidth="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
        <span className="text-sm text-[#cdd6f4]">PDF 预览</span>
        <span className="text-xs text-[#6c7086]">共 {totalPages} 页</span>
        <span className="text-xs text-[#6c7086]">· 支持文本选中复制</span>
        <div className="flex-1" />
        <button onClick={zoomOut} className="px-2 py-1 text-xs bg-[#313244] text-[#a6adc8] rounded hover:bg-[#45475a]">-</button>
        <span className="text-xs text-[#cdd6f4] w-12 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="px-2 py-1 text-xs bg-[#313244] text-[#a6adc8] rounded hover:bg-[#45475a]">+</button>
        <button onClick={resetZoom} className="px-2 py-1 text-xs bg-[#313244] text-[#a6adc8] rounded hover:bg-[#45475a]">重置</button>
      </div>

      {/* Pages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto bg-[#11111b] p-4" onContextMenu={handleContextMenu}>
        <div className="flex flex-col items-center gap-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              data-page={pageNum}
              className="shadow-lg bg-white relative"
              style={{ position: 'relative' }}
            >
              <canvas
                ref={el => { if (el) canvasRefs.current.set(pageNum, el) }}
              />
              {/* Text layer overlay for selectable text */}
              <div
                className="pdf-text-layer"
                ref={el => { if (el) textLayerRefs.current.set(pageNum, el) }}
              />
              <div className="text-center text-xs text-[#6c7086] py-1 bg-[#1e1e2e] relative z-10">
                第 {pageNum} 页
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          data-custom-context-menu
          className="fixed z-[100] bg-[#313244] border border-[#45475a] rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            animation: 'contextMenuFadeIn 0.12s ease-out',
          }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          <style>{`
            @keyframes contextMenuFadeIn {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
          <button
            className="w-full px-3 py-2 text-left text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2 transition-colors"
            onClick={() => handleCopy(contextMenu.text)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            复制
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm text-[#cdd6f4] hover:bg-[#45475a] flex items-center gap-2 transition-colors"
            onClick={() => handleSendToAI(contextMenu.text)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            发送到AI问答
          </button>
        </div>
      )}
    </div>
  )
}
