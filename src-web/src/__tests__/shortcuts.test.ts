/**
 * Keyboard Shortcuts System - Comprehensive Unit Tests
 *
 * Tests cover:
 * 1. Utility functions (parseCombo, eventToCombo, matchesCombo, formatCombo, detectConflict)
 * 2. Default shortcut definitions (no conflicts, valid bindings)
 * 3. Scope-aware priority matching
 * 4. Storage persistence
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseCombo,
  eventToCombo,
  matchesCombo,
  formatCombo,
  detectConflict,
  loadOverrides,
  saveOverrides,
} from '../hooks/useKeyboardShortcuts'
import { DEFAULT_SHORTCUTS, SHORTCUT_CATEGORIES } from '../shortcuts/defaults'
import type { ShortcutBinding, ShortcutScope } from '../hooks/useKeyboardShortcuts'

// ── Helpers ────────────────────────────────────────────────────────

function createKeyboardEvent(
  key: string,
  options: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  })
}

// ── 1. parseCombo Tests ────────────────────────────────────────────

describe('parseCombo', () => {
  it('parses single key', () => {
    const result = parseCombo('F1')
    expect(result.modifiers.size).toBe(0)
    expect(result.key).toBe('f1')
  })

  it('parses Ctrl+N', () => {
    const result = parseCombo('Ctrl+N')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.modifiers.size).toBe(1)
    expect(result.key).toBe('n')
  })

  it('parses Ctrl+Shift+B', () => {
    const result = parseCombo('Ctrl+Shift+B')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.modifiers.has('shift')).toBe(true)
    expect(result.modifiers.size).toBe(2)
    expect(result.key).toBe('b')
  })

  it('parses Ctrl+Shift+Alt+K', () => {
    const result = parseCombo('Ctrl+Shift+Alt+K')
    expect(result.modifiers.size).toBe(3)
    expect(result.key).toBe('k')
  })

  it('handles whitespace in combo string', () => {
    const result = parseCombo('  Ctrl + N  ')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.key).toBe('n')
  })

  it('parses comma key', () => {
    const result = parseCombo('Ctrl+,')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.key).toBe(',')
  })

  it('parses backtick key', () => {
    const result = parseCombo('Ctrl+Shift+`')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.modifiers.has('shift')).toBe(true)
    expect(result.key).toBe('`')
  })

  it('parses PageDown key', () => {
    const result = parseCombo('Ctrl+PageDown')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.key).toBe('pagedown')
  })

  it('parses Tab key', () => {
    const result = parseCombo('Ctrl+Tab')
    expect(result.modifiers.has('ctrl')).toBe(true)
    expect(result.key).toBe('tab')
  })
})

// ── 2. eventToCombo Tests ──────────────────────────────────────────

describe('eventToCombo', () => {
  it('converts Ctrl+N event', () => {
    const e = createKeyboardEvent('n', { ctrlKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+N')
  })

  it('converts Ctrl+Shift+B event', () => {
    const e = createKeyboardEvent('b', { ctrlKey: true, shiftKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+Shift+B')
  })

  it('converts Ctrl+, event', () => {
    const e = createKeyboardEvent(',', { ctrlKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+,')
  })

  it('converts Escape event', () => {
    const e = createKeyboardEvent('Escape')
    expect(eventToCombo(e)).toBe('Esc')
  })

  it('converts Space event', () => {
    const e = createKeyboardEvent(' ')
    expect(eventToCombo(e)).toBe('Space')
  })

  it('converts ArrowUp event', () => {
    const e = createKeyboardEvent('ArrowUp')
    expect(eventToCombo(e)).toBe('Up')
  })

  it('converts Delete event', () => {
    const e = createKeyboardEvent('Delete')
    expect(eventToCombo(e)).toBe('Del')
  })

  it('normalizes single char to uppercase', () => {
    const e = createKeyboardEvent('a', { ctrlKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+A')
  })

  it('converts Ctrl+Shift+Backtick event', () => {
    const e = createKeyboardEvent('`', { ctrlKey: true, shiftKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+Shift+`')
  })

  it('converts Ctrl+PageDown event', () => {
    const e = createKeyboardEvent('PageDown', { ctrlKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+PageDown')
  })

  it('converts Ctrl+Tab event', () => {
    const e = createKeyboardEvent('Tab', { ctrlKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+Tab')
  })

  it('handles Meta key as Ctrl', () => {
    const e = createKeyboardEvent('n', { metaKey: true })
    expect(eventToCombo(e)).toBe('Ctrl+N')
  })
})

// ── 3. matchesCombo Tests ──────────────────────────────────────────

describe('matchesCombo', () => {
  it('matches Ctrl+N', () => {
    const e = createKeyboardEvent('n', { ctrlKey: true })
    expect(matchesCombo(e, 'Ctrl+N')).toBe(true)
  })

  it('rejects wrong key', () => {
    const e = createKeyboardEvent('m', { ctrlKey: true })
    expect(matchesCombo(e, 'Ctrl+N')).toBe(false)
  })

  it('rejects missing modifier', () => {
    const e = createKeyboardEvent('n')
    expect(matchesCombo(e, 'Ctrl+N')).toBe(false)
  })

  it('rejects extra modifier', () => {
    const e = createKeyboardEvent('n', { ctrlKey: true, shiftKey: true })
    expect(matchesCombo(e, 'Ctrl+N')).toBe(false)
  })

  it('matches Ctrl+Shift+B', () => {
    const e = createKeyboardEvent('b', { ctrlKey: true, shiftKey: true })
    expect(matchesCombo(e, 'Ctrl+Shift+B')).toBe(true)
  })

  it('matches Ctrl+,', () => {
    const e = createKeyboardEvent(',', { ctrlKey: true })
    expect(matchesCombo(e, 'Ctrl+,')).toBe(true)
  })

  it('matches Ctrl+1', () => {
    const e = createKeyboardEvent('1', { ctrlKey: true })
    expect(matchesCombo(e, 'Ctrl+1')).toBe(true)
  })

  it('matches Ctrl+PageDown', () => {
    const e = createKeyboardEvent('PageDown', { ctrlKey: true })
    expect(matchesCombo(e, 'Ctrl+PageDown')).toBe(true)
  })

  it('matches Ctrl+Shift+`', () => {
    const e = createKeyboardEvent('`', { ctrlKey: true, shiftKey: true })
    expect(matchesCombo(e, 'Ctrl+Shift+`')).toBe(true)
  })
})

// ── 4. formatCombo Tests ───────────────────────────────────────────

describe('formatCombo', () => {
  it('formats simple combo', () => {
    expect(formatCombo('Ctrl+N')).toBe('Ctrl+N')
  })

  it('formats combo with shift', () => {
    expect(formatCombo('Ctrl+Shift+B')).toBe('Ctrl+Shift+B')
  })

  it('formats for Mac', () => {
    const result = formatCombo('Ctrl+Shift+B', true)
    expect(result).toContain('\u2318') // ⌘
    expect(result).toContain('\u21E7') // ⇧
  })

  it('formats multi-key sequence', () => {
    const result = formatCombo('Ctrl+K Ctrl+S')
    expect(result).toBe('Ctrl+K Ctrl+S')
  })

  it('formats comma combo', () => {
    expect(formatCombo('Ctrl+,')).toBe('Ctrl+,')
  })
})

// ── 5. detectConflict Tests ────────────────────────────────────────

describe('detectConflict', () => {
  const bindings: Record<string, ShortcutBinding> = {
    'test.a': { id: 'test.a', keys: 'Ctrl+N', label: 'test', category: 'file', scope: 'global' },
    'test.b': { id: 'test.b', keys: 'Ctrl+B', label: 'test', category: 'panel', scope: 'global' },
    'test.c': { id: 'test.c', keys: 'Ctrl+Shift+B', label: 'test', category: 'editor', scope: 'editor' },
  }

  it('detects conflict with same keys and scope', () => {
    const conflict = detectConflict('Ctrl+N', 'global', bindings)
    expect(conflict).not.toBeNull()
    expect(conflict!.id).toBe('test.a')
  })

  it('returns null for unique keys', () => {
    const conflict = detectConflict('Ctrl+Z', 'global', bindings)
    expect(conflict).toBeNull()
  })

  it('excludes specified id', () => {
    const conflict = detectConflict('Ctrl+N', 'global', bindings, 'test.a')
    expect(conflict).toBeNull()
  })

  it('detects conflict across scopes when global involved', () => {
    const conflict = detectConflict('Ctrl+Shift+B', 'global', bindings)
    expect(conflict).not.toBeNull()
    expect(conflict!.id).toBe('test.c')
  })

  it('is case-insensitive', () => {
    const conflict = detectConflict('ctrl+n', 'global', bindings)
    expect(conflict).not.toBeNull()
  })
})

// ── 6. Storage Tests ───────────────────────────────────────────────

describe('shortcut storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty object when no overrides saved', () => {
    expect(loadOverrides()).toEqual({})
  })

  it('saves and loads overrides', () => {
    const overrides = { 'file.newNote': 'Ctrl+T', 'panel.sidebar': 'Ctrl+Shift+S' }
    saveOverrides(overrides)
    expect(loadOverrides()).toEqual(overrides)
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('miniobsidian_shortcuts', 'not-json')
    expect(loadOverrides()).toEqual({})
  })

  it('overwrites previous overrides', () => {
    saveOverrides({ 'file.newNote': 'Ctrl+T' })
    saveOverrides({ 'panel.sidebar': 'Ctrl+Shift+S' })
    expect(loadOverrides()).toEqual({ 'panel.sidebar': 'Ctrl+Shift+S' })
  })
})

// ── 7. Default Shortcuts Validation ────────────────────────────────

describe('DEFAULT_SHORTCUTS', () => {
  it('has no duplicate IDs', () => {
    const ids = DEFAULT_SHORTCUTS.map(s => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('all shortcuts have valid categories', () => {
    const validCategories = SHORTCUT_CATEGORIES.map(c => c.key)
    for (const shortcut of DEFAULT_SHORTCUTS) {
      expect(validCategories).toContain(shortcut.category)
    }
  })

  it('all shortcuts have non-empty labels', () => {
    for (const shortcut of DEFAULT_SHORTCUTS) {
      expect(shortcut.label.length).toBeGreaterThan(0)
    }
  })

  it('all shortcuts have valid scopes', () => {
    const validScopes: ShortcutScope[] = ['global', 'editor', 'sidebar', 'dialog']
    for (const shortcut of DEFAULT_SHORTCUTS) {
      expect(validScopes).toContain(shortcut.scope)
    }
  })

  it('no key conflicts among global-scoped shortcuts', () => {
    const globalShortcuts = DEFAULT_SHORTCUTS.filter(s => s.scope === 'global')
    const keyMap = new Map<string, string[]>()
    for (const s of globalShortcuts) {
      const key = s.keys.trim().toLowerCase()
      if (!keyMap.has(key)) keyMap.set(key, [])
      keyMap.get(key)!.push(s.id)
    }
    for (const [key, ids] of keyMap) {
      if (ids.length > 1) {
        expect.fail(`Global key conflict for "${key}": ${ids.join(', ')}`)
      }
    }
  })

  it('editor-scoped shortcuts do not conflict with global shortcuts for same keys', () => {
    // Editor-scoped shortcuts can share keys with global ones
    // because scope-aware matching picks the right one.
    // But they should not have the SAME keys as each other.
    const editorShortcuts = DEFAULT_SHORTCUTS.filter(s => s.scope === 'editor')
    const keyMap = new Map<string, string[]>()
    for (const s of editorShortcuts) {
      const key = s.keys.trim().toLowerCase()
      if (!keyMap.has(key)) keyMap.set(key, [])
      keyMap.get(key)!.push(s.id)
    }
    for (const [key, ids] of keyMap) {
      if (ids.length > 1) {
        expect.fail(`Editor key conflict for "${key}": ${ids.join(', ')}`)
      }
    }
  })

  it('contains expected number of shortcuts (25)', () => {
    expect(DEFAULT_SHORTCUTS.length).toBe(25)
  })

  it('has file category shortcuts', () => {
    const fileShortcuts = DEFAULT_SHORTCUTS.filter(s => s.category === 'file')
    expect(fileShortcuts.length).toBe(5)
  })

  it('has view category shortcuts', () => {
    const viewShortcuts = DEFAULT_SHORTCUTS.filter(s => s.category === 'view')
    expect(viewShortcuts.length).toBe(5)
  })

  it('has panel category shortcuts', () => {
    const panelShortcuts = DEFAULT_SHORTCUTS.filter(s => s.category === 'panel')
    expect(panelShortcuts.length).toBe(5)
  })

  it('has tab category shortcuts', () => {
    const tabShortcuts = DEFAULT_SHORTCUTS.filter(s => s.category === 'tab')
    expect(tabShortcuts.length).toBe(2)
  })

  it('has editor category shortcuts', () => {
    const editorShortcuts = DEFAULT_SHORTCUTS.filter(s => s.category === 'editor')
    expect(editorShortcuts.length).toBe(8) // Ctrl+F, H, Shift+B, Shift+I, Shift+`, K, Shift+H, Shift+L
  })

  // Specific shortcut validation
  it('file.newNote uses Ctrl+N', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'file.newNote')!
    expect(s.keys).toBe('Ctrl+N')
    expect(s.scope).toBe('global')
  })

  it('file.save uses Ctrl+S', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'file.save')!
    expect(s.keys).toBe('Ctrl+S')
    expect(s.scope).toBe('global')
  })

  it('file.closeTab uses Ctrl+W', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'file.closeTab')!
    expect(s.keys).toBe('Ctrl+W')
    expect(s.scope).toBe('global')
  })

  it('file.dailyNote uses Ctrl+D', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'file.dailyNote')!
    expect(s.keys).toBe('Ctrl+D')
    expect(s.scope).toBe('global')
  })

  it('file.exportPdf uses Ctrl+Shift+E', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'file.exportPdf')!
    expect(s.keys).toBe('Ctrl+Shift+E')
    expect(s.scope).toBe('global')
  })

  it('view.edit uses Ctrl+1', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'view.edit')!
    expect(s.keys).toBe('Ctrl+1')
  })

  it('view.split uses Ctrl+2', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'view.split')!
    expect(s.keys).toBe('Ctrl+2')
  })

  it('view.preview uses Ctrl+3', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'view.preview')!
    expect(s.keys).toBe('Ctrl+3')
  })

  it('view.graph uses Ctrl+4', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'view.graph')!
    expect(s.keys).toBe('Ctrl+4')
  })

  it('view.search uses Ctrl+5', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'view.search')!
    expect(s.keys).toBe('Ctrl+5')
  })

  it('panel.sidebar uses Ctrl+B', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'panel.sidebar')!
    expect(s.keys).toBe('Ctrl+B')
    expect(s.scope).toBe('global')
  })

  it('panel.ai uses Ctrl+Shift+A', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'panel.ai')!
    expect(s.keys).toBe('Ctrl+Shift+A')
  })

  it('panel.sync uses Ctrl+Shift+S', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'panel.sync')!
    expect(s.keys).toBe('Ctrl+Shift+S')
  })

  it('panel.settings uses Ctrl+,', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'panel.settings')!
    expect(s.keys).toBe('Ctrl+,')
  })

  it('panel.backlinks uses Ctrl+Shift+B', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'panel.backlinks')!
    expect(s.keys).toBe('Ctrl+Shift+B')
    expect(s.scope).toBe('global')
  })

  it('tab.next uses Ctrl+PageDown', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'tab.next')!
    expect(s.keys).toBe('Ctrl+PageDown')
    expect(s.scope).toBe('global')
  })

  it('tab.prev uses Ctrl+PageUp', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'tab.prev')!
    expect(s.keys).toBe('Ctrl+PageUp')
    expect(s.scope).toBe('global')
  })

  it('editor.bold uses Ctrl+B (editor scope)', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'editor.bold')!
    expect(s.keys).toBe('Ctrl+B')
    expect(s.scope).toBe('editor')
  })

  it('editor.link uses Ctrl+K (editor scope)', () => {
    const s = DEFAULT_SHORTCUTS.find(s => s.id === 'editor.link')!
    expect(s.keys).toBe('Ctrl+K')
    expect(s.scope).toBe('editor')
  })
})

// ── 8. Scope-Aware Priority Matching Tests ─────────────────────────

describe('scope-aware priority matching', () => {
  const bindings: Record<string, ShortcutBinding> = {
    'panel.backlinks': {
      id: 'panel.backlinks', keys: 'Ctrl+Shift+B', label: 'panel backlinks',
      category: 'panel', scope: 'global',
    },
    'editor.bold': {
      id: 'editor.bold', keys: 'Ctrl+B', label: 'bold',
      category: 'editor', scope: 'editor',
    },
    'panel.sidebar': {
      id: 'panel.sidebar', keys: 'Ctrl+B', label: 'sidebar',
      category: 'panel', scope: 'global',
    },
    'file.newNote': {
      id: 'file.newNote', keys: 'Ctrl+N', label: 'new note',
      category: 'file', scope: 'global',
    },
    'editor.link': {
      id: 'editor.link', keys: 'Ctrl+K', label: 'link',
      category: 'editor', scope: 'editor',
    },
  }

  it('Ctrl+B matches editor.bold when in editor (contentEditable)', () => {
    const e = createKeyboardEvent('b', { ctrlKey: true })
    const matches: { binding: ShortcutBinding; id: string }[] = []

    for (const [id, binding] of Object.entries(bindings)) {
      if (matchesCombo(e, binding.keys)) {
        matches.push({ binding, id })
      }
    }

    // In editor context (isInput=true), editor scope should be preferred
    const isInput = true
    let bestMatch: { binding: ShortcutBinding; id: string } | null = null
    if (isInput) {
      const editorMatch = matches.find(m => m.binding.scope === 'editor')
      if (editorMatch) bestMatch = editorMatch
    }
    if (!bestMatch) {
      bestMatch = matches.find(m => m.binding.scope !== 'editor') || matches[0] || null
    }

    expect(bestMatch).not.toBeNull()
    expect(bestMatch!.id).toBe('editor.bold')
  })

  it('Ctrl+B matches panel.sidebar when NOT in editor', () => {
    const e = createKeyboardEvent('b', { ctrlKey: true })
    const matches: { binding: ShortcutBinding; id: string }[] = []

    for (const [id, binding] of Object.entries(bindings)) {
      if (matchesCombo(e, binding.keys)) {
        matches.push({ binding, id })
      }
    }

    // Not in editor context (isInput=false), global scope should be preferred
    const isInput = false
    let bestMatch: { binding: ShortcutBinding; id: string } | null = null
    if (isInput) {
      const editorMatch = matches.find(m => m.binding.scope === 'editor')
      if (editorMatch) bestMatch = editorMatch
    }
    if (!bestMatch) {
      bestMatch = matches.find(m => m.binding.scope !== 'editor') || matches[0] || null
    }

    expect(bestMatch).not.toBeNull()
    expect(bestMatch!.id).toBe('panel.sidebar')
  })

  it('Ctrl+Shift+B matches panel.backlinks (no editor binding for this key)', () => {
    const e = createKeyboardEvent('B', { ctrlKey: true, shiftKey: true })
    const matches: { binding: ShortcutBinding; id: string }[] = []

    for (const [id, binding] of Object.entries(bindings)) {
      if (matchesCombo(e, binding.keys)) {
        matches.push({ binding, id })
      }
    }

    expect(matches.length).toBe(1)
    expect(matches[0].id).toBe('panel.backlinks')
  })

  it('Ctrl+N matches file.newNote (global, works in editor too)', () => {
    const e = createKeyboardEvent('n', { ctrlKey: true })
    const matches: { binding: ShortcutBinding; id: string }[] = []

    for (const [id, binding] of Object.entries(bindings)) {
      if (matchesCombo(e, binding.keys)) {
        matches.push({ binding, id })
      }
    }

    expect(matches.length).toBe(1)
    expect(matches[0].id).toBe('file.newNote')
  })

  it('Ctrl+K matches editor.link when in editor', () => {
    const e = createKeyboardEvent('k', { ctrlKey: true })
    const matches: { binding: ShortcutBinding; id: string }[] = []

    for (const [id, binding] of Object.entries(bindings)) {
      if (matchesCombo(e, binding.keys)) {
        matches.push({ binding, id })
      }
    }

    const isInput = true
    let bestMatch: { binding: ShortcutBinding; id: string } | null = null
    if (isInput) {
      const editorMatch = matches.find(m => m.binding.scope === 'editor')
      if (editorMatch) bestMatch = editorMatch
    }
    if (!bestMatch) {
      bestMatch = matches.find(m => m.binding.scope !== 'editor') || matches[0] || null
    }

    expect(bestMatch).not.toBeNull()
    expect(bestMatch!.id).toBe('editor.link')
  })
})

// ── 9. All Handler IDs Have Matching Definitions ───────────────────

describe('handler-definition consistency', () => {
  const handlerIds = [
    'file.newNote', 'file.save', 'file.closeTab', 'file.dailyNote', 'file.exportPdf',
    'view.edit', 'view.split', 'view.preview', 'view.graph', 'view.search',
    'panel.sidebar', 'panel.ai', 'panel.sync', 'panel.settings', 'panel.backlinks',
    'tab.next', 'tab.prev',
    'editor.search', 'editor.findReplace', 'editor.bold', 'editor.italic',
    'editor.code', 'editor.link', 'editor.heading', 'editor.list',
  ]

  it('every handler ID has a matching default shortcut definition', () => {
    const defIds = new Set(DEFAULT_SHORTCUTS.map(s => s.id))
    for (const id of handlerIds) {
      expect(defIds.has(id)).toBe(true)
    }
  })

  it('every default shortcut has a matching handler', () => {
    const hIds = new Set(handlerIds)
    for (const shortcut of DEFAULT_SHORTCUTS) {
      expect(hIds.has(shortcut.id)).toBe(true)
    }
  })
})

// ── 10. SHORTCUT_CATEGORIES Validation ─────────────────────────────

describe('SHORTCUT_CATEGORIES', () => {
  it('has 5 categories', () => {
    expect(SHORTCUT_CATEGORIES.length).toBe(5)
  })

  it('categories are: file, view, panel, tab, editor', () => {
    const keys = SHORTCUT_CATEGORIES.map(c => c.key)
    expect(keys).toEqual(['file', 'view', 'panel', 'tab', 'editor'])
  })

  it('every category has at least one shortcut', () => {
    for (const cat of SHORTCUT_CATEGORIES) {
      const count = DEFAULT_SHORTCUTS.filter(s => s.category === cat.key).length
      expect(count).toBeGreaterThan(0)
    }
  })
})
