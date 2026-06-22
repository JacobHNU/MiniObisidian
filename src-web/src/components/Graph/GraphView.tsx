import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

interface GraphViewProps {
  onSelectNote?: (noteId: string) => void
  notes?: api.NoteMeta[]
}

export default function GraphView({ onSelectNote, notes = [] }: GraphViewProps) {
  const { t } = useI18n()
  const [data, setData] = useState<api.GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes] = useState<{ id: string; x: number; y: number; title: string; tags: string[] }[]>([])
  const [edges, setEdges] = useState<{ source: string; target: string }[]>([])
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  // Pan & zoom state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 900, h: 650 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => { loadGraphData() }, [])

  const loadGraphData = async () => {
    try {
      const graphData = await api.getGraphData()
      setData(graphData)
      const width = 900, height = 650
      const initialNodes = graphData.nodes.map((n) => ({
        id: n.id,
        x: width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: height / 2 + (Math.random() - 0.5) * height * 0.6,
        title: n.title,
        tags: n.tags,
      }))
      setNodes(initialNodes)
      setEdges(graphData.edges)
    } catch (e) {
      console.error('Failed to load graph data:', e)
    } finally {
      setLoading(false)
    }
  }

  // Force-directed layout
  useEffect(() => {
    if (nodes.length === 0) return
    const iterations = 80
    const repulsion = 6000
    const attraction = 0.008
    const damping = 0.88
    const width = 900, height = 650
    let current = nodes.map((n) => ({ ...n, vx: 0, vy: 0 }))

    for (let iter = 0; iter < iterations; iter++) {
      for (let i = 0; i < current.length; i++) {
        for (let j = i + 1; j < current.length; j++) {
          const dx = current[j].x - current[i].x
          const dy = current[j].y - current[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = repulsion / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          current[i].vx -= fx; current[i].vy -= fy
          current[j].vx += fx; current[j].vy += fy
        }
      }
      for (const edge of edges) {
        const s = current.find((n) => n.id === edge.source)
        const t = current.find((n) => n.id === edge.target)
        if (s && t) {
          const dx = t.x - s.x, dy = t.y - s.y
          s.vx += dx * attraction; s.vy += dy * attraction
          t.vx -= dx * attraction; t.vy -= dy * attraction
        }
      }
      for (const node of current) {
        node.vx *= damping; node.vy *= damping
        node.x += node.vx; node.y += node.vy
        node.x = Math.max(60, Math.min(width - 60, node.x))
        node.y = Math.max(60, Math.min(height - 60, node.y))
      }
    }
    setNodes(current.map(({ id, x, y, title, tags }) => ({ id, x, y, title, tags })))
  }, [data])

  const connectedNodes = useMemo(() => {
    if (!hoveredNode) return new Set<string>()
    const c = new Set<string>(); c.add(hoveredNode)
    for (const e of edges) {
      if (e.source === hoveredNode) c.add(e.target)
      if (e.target === hoveredNode) c.add(e.source)
    }
    return c
  }, [hoveredNode, edges])

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    // Only start pan if clicking on empty space (not on a node)
    const target = e.target as SVGElement
    if (target.closest('.graph-node')) return
    setIsPanning(true)
    setPanStart({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !svgRef.current) return
    const svgRect = svgRef.current.getBoundingClientRect()
    const scaleX = viewBox.w / svgRect.width
    const scaleY = viewBox.h / svgRect.height
    const dx = (e.clientX - panStart.x) * scaleX
    const dy = (e.clientY - panStart.y) * scaleY
    setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }))
    setPanStart({ x: e.clientX, y: e.clientY })
  }, [isPanning, panStart, viewBox.w, viewBox.h])

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
    if (!svgRef.current) return
    const svgRect = svgRef.current.getBoundingClientRect()
    // Mouse position relative to SVG element
    const mx = (e.clientX - svgRect.left) / svgRect.width
    const my = (e.clientY - svgRect.top) / svgRect.height
    setViewBox((prev) => {
      const newW = Math.max(200, Math.min(5000, prev.w * zoomFactor))
      const newH = Math.max(150, Math.min(3600, prev.h * zoomFactor))
      const newX = prev.x + (prev.w - newW) * mx
      const newY = prev.y + (prev.h - newH) * my
      return { x: newX, y: newY, w: newW, h: newH }
    })
  }, [])

  // Reset view
  const handleResetView = useCallback(() => {
    setViewBox({ x: 0, y: 0, w: 900, h: 650 })
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-text-muted">{t('graph.loading')}</div>
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <div className="text-4xl mb-3">🕸️</div>
          <p>{t('graph.noLinks')}</p>
          <p className="text-sm mt-1">{t('graph.useLinks')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden bg-base relative">
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          onClick={() => setViewBox((p) => ({ ...p, w: p.w * 0.85, h: p.h * 0.85 }))}
          className="w-8 h-8 rounded bg-muted hover:bg-hover text-text-primary flex items-center justify-center text-lg font-bold"
          title={t('graph.zoomIn')}
        >+</button>
        <button
          onClick={() => setViewBox((p) => ({ ...p, w: p.w * 1.15, h: p.h * 1.15 }))}
          className="w-8 h-8 rounded bg-muted hover:bg-hover text-text-primary flex items-center justify-center text-lg font-bold"
          title="Z o"
        >&#x2212;</button>
        <button
          onClick={handleResetView}
          className="w-8 h-8 rounded bg-muted hover:bg-hover text-text-primary flex items-center justify-center text-xs"
          title={t('graph.resetView')}
        >&#x2299;</button>
      </div>

      {/* Info */}
      <div className="absolute bottom-3 left-3 z-10 text-[10px] text-text-muted">
        {t('graph.hint')}
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className={`${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Edges */}
        {edges.map((edge, i) => {
          const source = nodes.find((n) => n.id === edge.source)
          const target = nodes.find((n) => n.id === edge.target)
          if (!source || !target) return null
          const isHL = hoveredNode && connectedNodes.has(edge.source) && connectedNodes.has(edge.target)
          return (
            <line key={i} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              stroke={isHL ? 'var(--accent)' : 'var(--border-hover)'} strokeWidth={isHL ? 2.5 : 1}
              opacity={hoveredNode && !isHL ? 0.15 : 0.8} />
          )
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isHovered = hoveredNode === node.id
          const isConn = connectedNodes.has(node.id)
          const dimmed = hoveredNode && !isConn
          const isDaily = node.tags?.includes('daily')
          return (
            <g key={node.id} className="graph-node"
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={(e) => {
                e.stopPropagation()
                if (onSelectNote) onSelectNote(node.id)
              }}
              style={{ cursor: 'pointer' }}>
              <circle cx={node.x} cy={node.y} r={isHovered ? 10 : 6}
                fill={isDaily ? 'var(--green)' : isHovered ? 'var(--accent)' : isConn ? 'var(--blue)' : 'var(--text-secondary)'}
                opacity={dimmed ? 0.2 : 1}
                stroke={isHovered ? 'var(--pink)' : 'none'} strokeWidth={2.5}
                className="cursor-pointer transition-all" />
              <text x={node.x} y={node.y - 14} textAnchor="middle"
                fill={dimmed ? 'var(--border-hover)' : 'var(--text-primary)'} fontSize={isHovered ? 14 : 11}
                fontWeight={isHovered ? 700 : 400} className="pointer-events-none select-none">
                {node.title}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
