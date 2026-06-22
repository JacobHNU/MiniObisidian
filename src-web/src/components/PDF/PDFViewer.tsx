import { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n } from '../../i18n'

// Dynamic import to avoid top-level await issues in Tauri/Vite
let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist')
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url
      ).toString()
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerSrc = ''
    }
  }
  return pdfjsLib
}

interface PDFViewerProps {
  fileData: ArrayBuffer | null
  fileName: string
  onClose: () => void
}

interface PageViewport {
  width: number
  height: number
}

export default function PDFViewer({ fileData, fileName, onClose }: PDFViewerProps) {
  const { t } = useI18n()
  const [pdf, setPdf] = useState<any>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<number[]>([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [outline, setOutline] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rotation, setRotation] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const thumbnailRefs = useRef<Map<number, HTMLCanvasElement>>(new Map())

  // Load PDF document
  useEffect(() => {
    if (!fileData) return

    const loadPdf = async () => {
      try {
        setLoading(true)
        setError(null)
        const lib = await getPdfjs()
        const loadingTask = lib.getDocument({ data: fileData })
        const pdfDoc = await loadingTask.promise
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        setCurrentPage(1)

        // Load outline (table of contents)
        try {
          const outlineData = await pdfDoc.getOutline()
          setOutline(outlineData || [])
        } catch {
          setOutline([])
        }
      } catch (err) {
        setError(t('pdf.loadFailed'))
        console.error('PDF load error:', err)
      } finally {
        setLoading(false)
      }
    }

    loadPdf()
  }, [fileData])

  // Render current page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return

    const renderPage = async () => {
      const page = await pdf.getPage(currentPage)
      const viewport = page.getViewport({ scale, rotation })
      const canvas = canvasRef.current!
      const context = canvas.getContext('2d')!

      canvas.height = viewport.height
      canvas.width = viewport.width

      await page.render({
        canvasContext: context,
        viewport
      }).promise
    }

    renderPage()
  }, [pdf, currentPage, scale, rotation])

  // Render thumbnails
  useEffect(() => {
    if (!pdf || !showThumbnails) return

    const renderThumbnails = async () => {
      for (let i = 1; i <= Math.min(totalPages, 20); i++) {
        const canvas = thumbnailRefs.current.get(i)
        if (!canvas) continue

        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 0.2 })
        const context = canvas.getContext('2d')!

        canvas.height = viewport.height
        canvas.width = viewport.width

        await page.render({
          canvasContext: context,
          viewport
        }).promise
      }
    }

    renderThumbnails()
  }, [pdf, showThumbnails, totalPages])

  // Search in PDF
  const handleSearch = useCallback(async () => {
    if (!pdf || !searchText.trim()) {
      setSearchResults([])
      return
    }

    const pages: number[] = []
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ')
      if (text.toLowerCase().includes(searchText.toLowerCase())) {
        pages.push(i)
      }
    }
    setSearchResults(pages)
    setCurrentSearchIndex(0)
    if (pages.length > 0) {
      setCurrentPage(pages[0])
    }
  }, [pdf, searchText, totalPages])

  // Navigate search results
  const nextSearchResult = () => {
    if (searchResults.length === 0) return
    const nextIndex = (currentSearchIndex + 1) % searchResults.length
    setCurrentSearchIndex(nextIndex)
    setCurrentPage(searchResults[nextIndex])
  }

  const prevSearchResult = () => {
    if (searchResults.length === 0) return
    const prevIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length
    setCurrentSearchIndex(prevIndex)
    setCurrentPage(searchResults[prevIndex])
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setCurrentPage(p => Math.max(1, p - 1))
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setCurrentPage(p => Math.min(totalPages, p + 1))
      } else if (e.key === 'Home') {
        setCurrentPage(1)
      } else if (e.key === 'End') {
        setCurrentPage(totalPages)
      } else if (e.ctrlKey && e.key === '=') {
        setScale(s => Math.min(3, s + 0.25))
      } else if (e.ctrlKey && e.key === '-') {
        setScale(s => Math.max(0.5, s - 0.25))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, totalPages])

  // Render outline tree
  const renderOutline = (items: any[], depth = 0) => {
    return items.map((item: any, index: number) => (
      <div key={index} style={{ paddingLeft: `${depth * 16}px` }}>
        <button
          onClick={async () => {
            if (item.dest) {
              try {
                let dest = item.dest
                if (typeof dest === 'string') {
                  dest = await pdf.getDestination(dest)
                }
                if (dest && dest[0]) {
                  const pageIndex = await pdf.getPageIndex(dest[0])
                  setCurrentPage(pageIndex + 1)
                }
              } catch (e) {
                console.error('Navigate to outline failed:', e)
              }
            }
          }}
          className="w-full text-left px-2 py-1 hover:bg-hover rounded text-sm truncate"
        >
          {item.title}
        </button>
        {item.items && item.items.length > 0 && renderOutline(item.items, depth + 1)}
      </div>
    ))
  }

  if (!fileData) return null

  return (
    <div className="fixed inset-0 z-50 bg-base flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border-hover">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="px-2 py-1 hover:bg-hover rounded text-sm">
            {t('pdf.back')}
          </button>
          <span className="text-sm text-text-primary font-medium truncate max-w-[300px]">
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Page navigation */}
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-2 py-1 hover:bg-hover rounded text-sm disabled:opacity-50"
          >
            ◀
          </button>
          <input
            type="number"
            value={currentPage}
            onChange={e => {
              const page = parseInt(e.target.value)
              if (page >= 1 && page <= totalPages) setCurrentPage(page)
            }}
            className="w-12 text-center bg-base border border-border-hover rounded px-1 py-0.5 text-sm"
          />
          <span className="text-sm text-text-secondary">/ {totalPages}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-2 py-1 hover:bg-hover rounded text-sm disabled:opacity-50"
          >
            ▶
          </button>

          <div className="w-px h-4 bg-hover" />

          {/* Zoom */}
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="px-2 py-1 hover:bg-hover rounded text-sm"
          >
            −
          </button>
          <span className="text-sm text-text-secondary w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.25))}
            className="px-2 py-1 hover:bg-hover rounded text-sm"
          >
            +
          </button>

          {/* Rotation */}
          <button
            onClick={() => setRotation(r => (r + 90) % 360)}
            className="px-2 py-1 hover:bg-hover rounded text-sm"
          >
            ↻
          </button>

          <div className="w-px h-4 bg-hover" />

          {/* Thumbnails toggle */}
          <button
            onClick={() => setShowThumbnails(!showThumbnails)}
            className={`px-2 py-1 rounded text-sm ${showThumbnails ? 'bg-hover' : 'hover:bg-hover'}`}
          >
            {t('pdf.thumbnails')}
          </button>

          {/* Outline toggle */}
          <button
            onClick={() => setShowOutline(!showOutline)}
            className={`px-2 py-1 rounded text-sm ${showOutline ? 'bg-hover' : 'hover:bg-hover'}`}
          >
            {t('pdf.toc')}
          </button>

          <div className="w-px h-4 bg-hover" />

          {/* Search */}
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="搜索..."
            className="w-32 bg-base border border-border-hover rounded px-2 py-0.5 text-sm"
          />
          {searchResults.length > 0 && (
            <>
              <span className="text-xs text-text-secondary">
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button onClick={prevSearchResult} className="px-1 py-0.5 hover:bg-hover rounded text-xs">
                ▲
              </button>
              <button onClick={nextSearchResult} className="px-1 py-0.5 hover:bg-hover rounded text-xs">
                ▼
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Thumbnails or Outline */}
        {(showThumbnails || showOutline) && (
          <div className="w-48 bg-muted border-r border-border-hover overflow-y-auto p-2">
            {showThumbnails && (
              <div className="space-y-2">
                {Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1).map(pageNum => (
                  <div
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`cursor-pointer border rounded overflow-hidden ${
                      currentPage === pageNum ? 'border-blue' : 'border-border-hover'
                    }`}
                  >
                    <canvas
                      ref={el => {
                        if (el) thumbnailRefs.current.set(pageNum, el)
                      }}
                      className="w-full"
                    />
                    <div className="text-center text-xs py-1 bg-base">
                      第 {pageNum} 页
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showOutline && (
              <div className="space-y-0.5">
                {outline.length > 0 ? (
                  renderOutline(outline)
                ) : (
                  <p className="text-sm text-text-secondary text-center py-4">
                    无目录信息
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* PDF Canvas */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto flex items-start justify-center p-4 bg-surface"
        >
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-text-primary">加载中...</div>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-red">{error}</div>
            </div>
          )}
          {!loading && !error && (
            <canvas
              ref={canvasRef}
              className="shadow-lg"
            />
          )}
        </div>
      </div>
    </div>
  )
}
