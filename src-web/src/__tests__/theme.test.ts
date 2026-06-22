import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  applyTheme,
  applyFontSizes,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  type AppSettings,
} from '../components/Settings/SettingsPanel'

// ── Unit Tests: loadSettings / saveSettings ─────────────────────────
describe('Settings persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when localStorage is empty', () => {
    const s = loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored values with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'light' }))
    const s = loadSettings()
    expect(s.theme).toBe('light')
    expect(s.uiFontSize).toBe(DEFAULT_SETTINGS.uiFontSize)
  })

  it('round-trips settings through save/load', () => {
    const custom: AppSettings = { theme: 'light', uiFontSize: 16, editorFontSize: 18, language: 'en' }
    saveSettings(custom)
    expect(loadSettings()).toEqual(custom)
  })

  it('handles corrupt JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const s = loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })
})

// ── Unit Tests: applyTheme ──────────────────────────────────────────
describe('applyTheme', () => {
  beforeEach(() => {
    // Reset all CSS variables
    const root = document.documentElement
    root.removeAttribute('style')
    root.classList.remove('light-theme', 'dark-theme')
  })

  it('sets dark theme CSS variables on <html>', () => {
    applyTheme('dark')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--bg-base')).toBe('#1e1e2e')
    expect(root.style.getPropertyValue('--accent')).toBe('#cba6f7')
    expect(root.style.getPropertyValue('--text-primary')).toBe('#cdd6f4')
    expect(root.classList.contains('dark-theme')).toBe(true)
    expect(root.classList.contains('light-theme')).toBe(false)
  })

  it('sets light theme CSS variables on <html>', () => {
    applyTheme('light')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--bg-base')).toBe('#eff1f5')
    expect(root.style.getPropertyValue('--accent')).toBe('#8839ef')
    expect(root.style.getPropertyValue('--text-primary')).toBe('#4c4f69')
    expect(root.classList.contains('light-theme')).toBe(true)
    expect(root.classList.contains('dark-theme')).toBe(false)
  })

  it('switches from dark to light cleanly', () => {
    applyTheme('dark')
    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#1e1e2e')

    applyTheme('light')
    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#eff1f5')
    expect(document.documentElement.classList.contains('light-theme')).toBe(true)
    expect(document.documentElement.classList.contains('dark-theme')).toBe(false)
  })

  it('sets all expected CSS variables', () => {
    applyTheme('dark')
    const root = document.documentElement
    const expectedVars = [
      '--bg-base', '--bg-surface', '--bg-overlay', '--bg-muted', '--bg-hover', '--bg-subtle',
      '--accent', '--red', '--blue', '--green', '--yellow', '--orange', '--pink',
      '--sky', '--teal', '--lavender', '--rosewater',
      '--text-primary', '--text-secondary', '--text-muted', '--text-subtle',
      '--text-inverse', '--text-overlay', '--text-surface',
      '--border-muted', '--border-hover', '--border-subtle', '--border-base',
    ]
    for (const v of expectedVars) {
      expect(root.style.getPropertyValue(v), `expected ${v} to be set`).not.toBe('')
    }
  })
})

// ── Unit Tests: applyFontSizes ──────────────────────────────────────
describe('applyFontSizes', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('sets UI and editor font size CSS variables', () => {
    applyFontSizes(16, 18)
    const root = document.documentElement
    expect(root.style.getPropertyValue('--ui-font-size')).toBe('16px')
    expect(root.style.getPropertyValue('--editor-font-size')).toBe('18px')
  })
})

// ── Integration Test: full theme switching flow ─────────────────────
describe('Theme switching integration', () => {
  beforeEach(() => {
    localStorage.clear()
    const root = document.documentElement
    root.removeAttribute('style')
    root.classList.remove('light-theme', 'dark-theme')
  })

  it('persists theme choice across save/load/apply cycle', () => {
    // 1. Start with defaults
    let settings = loadSettings()
    expect(settings.theme).toBe('dark')

    // 2. Switch to light
    settings = { ...settings, theme: 'light' }
    saveSettings(settings)
    applyTheme(settings.theme)

    // 3. Verify DOM state
    expect(document.documentElement.classList.contains('light-theme')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#eff1f5')

    // 4. Reload settings (simulates page refresh)
    const reloaded = loadSettings()
    expect(reloaded.theme).toBe('light')

    // 5. Apply reloaded settings
    applyTheme(reloaded.theme)
    expect(document.documentElement.classList.contains('light-theme')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--bg-base')).toBe('#eff1f5')
  })

  it('handles rapid theme toggling without state corruption', () => {
    for (let i = 0; i < 10; i++) {
      const theme = i % 2 === 0 ? 'dark' : 'light'
      applyTheme(theme)
      const root = document.documentElement
      if (theme === 'dark') {
        expect(root.style.getPropertyValue('--bg-base')).toBe('#1e1e2e')
        expect(root.classList.contains('dark-theme')).toBe(true)
      } else {
        expect(root.style.getPropertyValue('--bg-base')).toBe('#eff1f5')
        expect(root.classList.contains('light-theme')).toBe(true)
      }
    }
  })

  it('font size changes persist alongside theme', () => {
    const settings: AppSettings = { theme: 'light', uiFontSize: 16, editorFontSize: 18, language: 'en' }
    saveSettings(settings)
    applyTheme(settings.theme)
    applyFontSizes(settings.uiFontSize, settings.editorFontSize)

    const reloaded = loadSettings()
    expect(reloaded.theme).toBe('light')
    expect(reloaded.uiFontSize).toBe(16)
    expect(reloaded.editorFontSize).toBe(18)

    applyFontSizes(reloaded.uiFontSize, reloaded.editorFontSize)
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('16px')
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('18px')
  })
})
