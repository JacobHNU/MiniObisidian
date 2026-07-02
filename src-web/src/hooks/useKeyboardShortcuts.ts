/**
 * Keyboard Shortcuts Engine
 *
 * Provides centralized shortcut registration, conflict detection,
 * runtime modification, and persistence via localStorage.
 *
 * Supports:
 * - Single key (F1), combo keys (Ctrl+N), sequences (Ctrl+K Ctrl+S)
 * - Global vs context-scoped shortcuts
 * - Conflict detection within same scope
 * - Runtime rebinding with persistence
 */

import { useEffect, useRef, useCallback, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────────

export type ShortcutScope = 'global' | 'editor' | 'sidebar' | 'dialog'

export interface ShortcutBinding {
  id: string
  keys: string            // e.g. "Ctrl+N", "Ctrl+K Ctrl+S"
  label: string           // i18n key for display name
  category: string        // grouping key
  scope: ShortcutScope
  /** If true, preventDefault is called to stop CodeMirror from also handling it */
  preventEditorDefault?: boolean
}

export interface ShortcutState {
  bindings: Record<string, ShortcutBinding>  // id -> binding
  overrides: Record<string, string>           // id -> custom keys (persisted)
}

// ── Key parsing utilities ──────────────────────────────────────────

const MODIFIERS = ['ctrl', 'shift', 'alt', 'meta'] as const

/**
 * Parse a key combo string like "Ctrl+Shift+N" into normalized parts.
 * Returns { modifiers: Set<string>, key: string }
 */
export function parseCombo(combo: string): { modifiers: Set<string>; key: string } {
  const parts = combo.trim().toLowerCase().split('+').map(p => p.trim())
  const modifiers = new Set<string>()
  let key = ''

  for (const part of parts) {
    if ((MODIFIERS as readonly string[]).includes(part)) {
      modifiers.add(part)
    } else {
      key = part
    }
  }

  return { modifiers, key }
}

/**
 * Convert a KeyboardEvent into a normalized combo string like "Ctrl+Shift+A"
 */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  let key = e.key
  // Normalize special keys
  if (key === ' ') key = 'Space'
  else if (key === 'Escape') key = 'Esc'
  else if (key === 'ArrowUp') key = 'Up'
  else if (key === 'ArrowDown') key = 'Down'
  else if (key === 'ArrowLeft') key = 'Left'
  else if (key === 'ArrowRight') key = 'Right'
  else if (key === 'Delete') key = 'Del'
  else if (key.length === 1) key = key.toUpperCase()

  // Don't add modifier keys as the "key" part
  if ((MODIFIERS as readonly string[]).includes(key.toLowerCase())) {
    return parts.join('+')
  }

  parts.push(key)
  return parts.join('+')
}

/**
 * Check if a KeyboardEvent matches a combo string.
 */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const eventCombo = eventToCombo(e)
  const { modifiers: reqMods, key: reqKey } = parseCombo(combo)

  const actual = parseCombo(eventCombo)

  // Key must match
  if (actual.key !== reqKey) return false

  // All required modifiers must be present
  for (const mod of reqMods) {
    if (!actual.modifiers.has(mod)) return false
  }

  // No extra modifiers allowed
  if (actual.modifiers.size !== reqMods.size) return false

  return true
}

/**
 * Format a combo string for display.
 * On Mac: uses symbols; on others: uses text.
 */
export function formatCombo(keys: string, isMac = false): string {
  // Handle sequences like "Ctrl+K Ctrl+S"
  return keys.split(' ').map(combo => {
    const parts = combo.split('+').map(p => p.trim())
    return parts.map(p => {
      const lower = p.toLowerCase()
      if (isMac) {
        if (lower === 'ctrl') return '\u2318'
        if (lower === 'shift') return '\u21E7'
        if (lower === 'alt') return '\u2325'
        if (lower === 'meta') return '\u2318'
      }
      return p.length === 1 ? p : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    }).join(isMac ? '' : '+')
  }).join(' ')
}

/**
 * Check if two shortcut bindings conflict (same keys in same scope).
 */
export function detectConflict(
  newKeys: string,
  scope: ShortcutScope,
  bindings: Record<string, ShortcutBinding>,
  excludeId?: string
): ShortcutBinding | null {
  const normalizedNew = newKeys.trim().toLowerCase()
  for (const [id, binding] of Object.entries(bindings)) {
    if (id === excludeId) continue
    if (binding.scope !== scope && binding.scope !== 'global' && scope !== 'global') continue
    if (binding.keys.trim().toLowerCase() === normalizedNew) {
      return binding
    }
  }
  return null
}

// ── Storage ────────────────────────────────────────────────────────

const STORAGE_KEY = 'miniobsidian_shortcuts'

export function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

export function saveOverrides(overrides: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

// ── Hook ───────────────────────────────────────────────────────────

export function useKeyboardShortcuts(
  defaultBindings: ShortcutBinding[],
  handlers: Record<string, (e: KeyboardEvent) => void>
) {
  const overridesRef = useRef(loadOverrides())
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // Build effective bindings: defaults merged with user overrides
  const effectiveBindings = useMemo(() => {
    const map: Record<string, ShortcutBinding> = {}
    for (const binding of defaultBindings) {
      const overrideKeys = overridesRef.current[binding.id]
      map[binding.id] = overrideKeys
        ? { ...binding, keys: overrideKeys }
        : binding
    }
    return map
  }, [defaultBindings])

  const bindingsRef = useRef(effectiveBindings)
  bindingsRef.current = effectiveBindings

  // Sequence tracking for multi-key shortcuts (e.g. Ctrl+K Ctrl+S)
  const sequenceRef = useRef<string[]>([])
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Main keydown handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if target is an input/textarea (unless it's a global shortcut)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      const combo = eventToCombo(e)
      if (!combo) return

      // Add to sequence
      const prevSequence = sequenceRef.current
      const sequence = [...prevSequence, combo]

      // Clear sequence timer
      if (sequenceTimerRef.current) {
        clearTimeout(sequenceTimerRef.current)
      }

      // Find ALL matching bindings, then pick the best one based on scope priority
      const allBindings = Object.entries(bindingsRef.current)
      const matches: { binding: ShortcutBinding; id: string }[] = []

      for (const [id, binding] of allBindings) {
        const bindingKeys = binding.keys.trim()

        if (bindingKeys.includes(' ')) {
          // Multi-key sequence: e.g. "Ctrl+K Ctrl+S"
          const seqStr = sequence.join(' ')
          if (bindingKeys.toLowerCase() === seqStr.toLowerCase()) {
            matches.push({ binding, id })
          }
        } else {
          // Single combo
          if (matchesCombo(e, bindingKeys)) {
            matches.push({ binding, id })
          }
        }
      }

      // Pick the best match based on scope priority:
      // 1. When focus is in editor (contentEditable): editor scope > global scope
      // 2. Otherwise: global scope only
      let bestMatch: { binding: ShortcutBinding; id: string } | null = null
      if (isInput) {
        // Prefer editor-scoped bindings when in editor
        const editorMatch = matches.find(m => m.binding.scope === 'editor')
        if (editorMatch) {
          bestMatch = editorMatch
        }
        // For global-scoped bindings in editor: skip if there's no handler
        // or if the binding is not relevant to inputs
        // (global shortcuts with real handlers DO work in editor)
      }
      if (!bestMatch) {
        bestMatch = matches.find(m => m.binding.scope !== 'editor') || matches[0] || null
      }

      if (bestMatch) {
        const handler = handlersRef.current[bestMatch.id]
        if (handler) {
          // For editor-scoped bindings when not in editor, skip
          if (!isInput && bestMatch.binding.scope === 'editor') {
            sequenceRef.current = []
            return
          }

          e.preventDefault()
          e.stopPropagation()
          handler(e)
          sequenceRef.current = []
          return
        }
      }

      // If we matched a partial sequence prefix, keep waiting
      const bindings = Object.values(bindingsRef.current)
      const hasPrefix = bindings.some(b => {
        const keys = b.keys.trim()
        if (!keys.includes(' ')) return false
        const seqStr = sequence.join(' ')
        return keys.toLowerCase().startsWith(seqStr.toLowerCase())
      })

      if (hasPrefix) {
        sequenceRef.current = sequence
        // Timeout after 1.5s to reset sequence
        sequenceTimerRef.current = setTimeout(() => {
          sequenceRef.current = []
        }, 1500)
      } else {
        sequenceRef.current = []
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // API to update a shortcut binding at runtime
  const updateBinding = useCallback((id: string, newKeys: string) => {
    const overrides = { ...overridesRef.current, [id]: newKeys }
    overridesRef.current = overrides
    saveOverrides(overrides)
  }, [])

  // API to reset a single binding to default
  const resetBinding = useCallback((id: string) => {
    const overrides = { ...overridesRef.current }
    delete overrides[id]
    overridesRef.current = overrides
    saveOverrides(overrides)
  }, [])

  // API to reset all bindings to defaults
  const resetAll = useCallback(() => {
    overridesRef.current = {}
    saveOverrides({})
  }, [])

  return {
    bindings: effectiveBindings,
    updateBinding,
    resetBinding,
    resetAll,
  }
}
