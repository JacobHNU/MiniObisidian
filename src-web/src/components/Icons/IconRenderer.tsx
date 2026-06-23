import { useMemo } from 'react'
import * as LucideIcons from 'lucide-react'

interface IconRendererProps {
  icon: string | null | undefined
  size?: number
  className?: string
  fallback?: React.ReactNode
}

// Check if a string is an emoji (contains non-ASCII characters or common emoji ranges)
function isEmoji(str: string): boolean {
  // Emoji typically contain characters outside basic Latin range
  // Simple heuristic: if first char code > 255 or is in common emoji ranges
  const code = str.codePointAt(0) || 0
  return code > 255 || (code >= 0x1F300 && code <= 0x1FAFF) || (code >= 0x2600 && code <= 0x27BF)
}

// Get a lucide icon component by name (case-insensitive lookup)
function getLucideIcon(name: string): React.ComponentType<{ size?: number; className?: string }> | null {
  // Try exact match first
  if ((LucideIcons as Record<string, unknown>)[name]) {
    return (LucideIcons as Record<string, unknown>)[name] as React.ComponentType<{ size?: number; className?: string }>
  }
  // Try PascalCase (lucide convention)
  const pascal = name.charAt(0).toUpperCase() + name.slice(1)
  if ((LucideIcons as Record<string, unknown>)[pascal]) {
    return (LucideIcons as Record<string, unknown>)[pascal] as React.ComponentType<{ size?: number; className?: string }>
  }
  // Try with common suffixes
  for (const suffix of ['', 'Icon']) {
    const attempt = pascal + suffix
    if ((LucideIcons as Record<string, unknown>)[attempt]) {
      return (LucideIcons as Record<string, unknown>)[attempt] as React.ComponentType<{ size?: number; className?: string }>
    }
  }
  return null
}

export default function IconRenderer({ icon, size = 16, className = '', fallback }: IconRendererProps) {
  const rendered = useMemo(() => {
    if (!icon) return fallback || <LucideIcons.FileText size={size} className={className} />

    if (isEmoji(icon)) {
      return <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>
    }

    const LucideIcon = getLucideIcon(icon)
    if (LucideIcon) {
      return <LucideIcon size={size} className={className} />
    }

    // Fallback: treat as text (could be a short label)
    return <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>
  }, [icon, size, className, fallback])

  return <>{rendered}</>
}
