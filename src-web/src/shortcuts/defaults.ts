/**
 * Default keyboard shortcut bindings for the application.
 *
 * Categories:
 * - file:    File operations (new, save, close)
 * - view:    View mode switching
 * - panel:   Panel toggles (sidebar, AI, sync, settings)
 * - tab:     Tab navigation
 * - editor:  Editor-specific actions
 */

import type { ShortcutBinding } from '../hooks/useKeyboardShortcuts'

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  // ── File Operations ─────────────────────────────────────────────
  {
    id: 'file.newNote',
    keys: 'Ctrl+N',
    label: 'shortcuts.file.newNote',
    category: 'file',
    scope: 'global',
  },
  {
    id: 'file.save',
    keys: 'Ctrl+S',
    label: 'shortcuts.file.save',
    category: 'file',
    scope: 'global',
    preventEditorDefault: true,
  },
  {
    id: 'file.closeTab',
    keys: 'Ctrl+W',
    label: 'shortcuts.file.closeTab',
    category: 'file',
    scope: 'global',
    preventEditorDefault: true,
  },
  {
    id: 'file.dailyNote',
    keys: 'Ctrl+D',
    label: 'shortcuts.file.dailyNote',
    category: 'file',
    scope: 'global',
  },
  {
    id: 'file.exportPdf',
    keys: 'Ctrl+Shift+E',
    label: 'shortcuts.file.exportPdf',
    category: 'file',
    scope: 'global',
  },

  // ── View Mode Switching ─────────────────────────────────────────
  {
    id: 'view.edit',
    keys: 'Ctrl+1',
    label: 'shortcuts.view.edit',
    category: 'view',
    scope: 'global',
  },
  {
    id: 'view.split',
    keys: 'Ctrl+2',
    label: 'shortcuts.view.split',
    category: 'view',
    scope: 'global',
  },
  {
    id: 'view.preview',
    keys: 'Ctrl+3',
    label: 'shortcuts.view.preview',
    category: 'view',
    scope: 'global',
  },
  {
    id: 'view.graph',
    keys: 'Ctrl+4',
    label: 'shortcuts.view.graph',
    category: 'view',
    scope: 'global',
  },
  {
    id: 'view.search',
    keys: 'Ctrl+5',
    label: 'shortcuts.view.search',
    category: 'view',
    scope: 'global',
  },

  // ── Panel Toggles ───────────────────────────────────────────────
  {
    id: 'panel.sidebar',
    keys: 'Ctrl+B',
    label: 'shortcuts.panel.sidebar',
    category: 'panel',
    scope: 'global',
  },
  {
    id: 'panel.ai',
    keys: 'Ctrl+Shift+A',
    label: 'shortcuts.panel.ai',
    category: 'panel',
    scope: 'global',
  },
  {
    id: 'panel.sync',
    keys: 'Ctrl+Shift+S',
    label: 'shortcuts.panel.sync',
    category: 'panel',
    scope: 'global',
  },
  {
    id: 'panel.settings',
    keys: 'Ctrl+,',
    label: 'shortcuts.panel.settings',
    category: 'panel',
    scope: 'global',
  },
  {
    id: 'panel.backlinks',
    keys: 'Ctrl+Shift+B',
    label: 'shortcuts.panel.backlinks',
    category: 'panel',
    scope: 'global',
  },

  // ── Tab Navigation ──────────────────────────────────────────────
  // Note: Ctrl+Tab/Ctrl+Shift+Tab are intercepted by Windows OS.
  // Using Ctrl+PageDown/PageUp as cross-platform alternative.
  {
    id: 'tab.next',
    keys: 'Ctrl+PageDown',
    label: 'shortcuts.tab.next',
    category: 'tab',
    scope: 'global',
  },
  {
    id: 'tab.prev',
    keys: 'Ctrl+PageUp',
    label: 'shortcuts.tab.prev',
    category: 'tab',
    scope: 'global',
  },

  // ── Editor ──────────────────────────────────────────────────────
  // Note: Ctrl+F, Ctrl+H, Ctrl+Z, Ctrl+Y are handled natively by CodeMirror.
  // Bold/italic/code/link/heading/list are handled by CodeMirror custom keymap
  // (see CodeMirrorEditor.tsx markdownFormattingKeymap).
  // These entries are kept for display in the settings UI only.
  {
    id: 'editor.search',
    keys: 'Ctrl+F',
    label: 'shortcuts.editor.search',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.findReplace',
    keys: 'Ctrl+H',
    label: 'shortcuts.editor.findReplace',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.bold',
    keys: 'Ctrl+B',
    label: 'shortcuts.editor.bold',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.italic',
    keys: 'Ctrl+I',
    label: 'shortcuts.editor.italic',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.code',
    keys: 'Ctrl+Shift+`',
    label: 'shortcuts.editor.code',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.link',
    keys: 'Ctrl+K',
    label: 'shortcuts.editor.link',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.heading',
    keys: 'Ctrl+Shift+H',
    label: 'shortcuts.editor.heading',
    category: 'editor',
    scope: 'editor',
  },
  {
    id: 'editor.list',
    keys: 'Ctrl+Shift+L',
    label: 'shortcuts.editor.list',
    category: 'editor',
    scope: 'editor',
  },
]

/** Category display order and labels */
export const SHORTCUT_CATEGORIES = [
  { key: 'file',   label: 'shortcuts.category.file' },
  { key: 'view',   label: 'shortcuts.category.view' },
  { key: 'panel',  label: 'shortcuts.category.panel' },
  { key: 'tab',    label: 'shortcuts.category.tab' },
  { key: 'editor', label: 'shortcuts.category.editor' },
] as const
