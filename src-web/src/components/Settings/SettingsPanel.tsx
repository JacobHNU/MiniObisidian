import { useState, useEffect, useCallback, useRef } from 'react'
import { useI18n, type Language } from '../../i18n'
import { DEFAULT_SHORTCUTS, SHORTCUT_CATEGORIES } from '../../shortcuts/defaults'
import { formatCombo, detectConflict, eventToCombo, loadOverrides } from '../../hooks/useKeyboardShortcuts'
import type { ShortcutBinding, ShortcutScope } from '../../hooks/useKeyboardShortcuts'

// ── Types ──────────────────────────────────────────────────────────
type SettingsTab = 'about' | 'appearance' | 'shortcuts'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenGuide?: () => void
  shortcutBindings?: Record<string, ShortcutBinding>
  onUpdateShortcut?: (id: string, newKeys: string) => void
  onResetShortcut?: (id: string) => void
  onResetAllShortcuts?: () => void
}

// ── Theme / Font persistence helpers ───────────────────────────────
export const STORAGE_KEY = 'miniobsidian_settings'

export interface AppSettings {
  theme: 'dark' | 'light'
  uiFontSize: number      // global UI font size (px)
  editorFontSize: number  // note content font size (px)
  language: 'zh' | 'en'
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  uiFontSize: 14,
  editorFontSize: 15,
  language: 'zh',
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ── Theme color definitions ────────────────────────────────────────
const DARK_COLORS: Record<string, string> = {
  '--bg-base': '#1e1e2e', '--bg-surface': '#181825', '--bg-overlay': '#11111b',
  '--bg-muted': '#313244', '--bg-hover': '#45475a', '--bg-subtle': '#585b70',
  '--accent': '#cba6f7', '--red': '#f38ba8', '--blue': '#89b4fa',
  '--green': '#a6e3a1', '--yellow': '#f9e2af', '--orange': '#fab387',
  '--pink': '#f5c2e7', '--sky': '#89dceb', '--teal': '#94e2d5',
  '--lavender': '#b4befe', '--rosewater': '#f5e0dc',
  '--text-primary': '#cdd6f4', '--text-secondary': '#a6adc8',
  '--text-muted': '#6c7086', '--text-subtle': '#585b70',
  '--text-inverse': '#1e1e2e', '--text-overlay': '#5c5f77', '--text-surface': '#45475a',
  '--border-muted': '#313244', '--border-hover': '#45475a',
  '--border-subtle': '#585b70', '--border-base': '#1e1e2e',
}
const LIGHT_COLORS: Record<string, string> = {
  '--bg-base': '#eff1f5', '--bg-surface': '#e6e9ef', '--bg-overlay': '#dce0e8',
  '--bg-muted': '#ccd0da', '--bg-hover': '#bcc0cc', '--bg-subtle': '#9ca0b0',
  '--accent': '#8839ef', '--red': '#d20f39', '--blue': '#1e66f5',
  '--green': '#40a02b', '--yellow': '#df8e1d', '--orange': '#fe640b',
  '--pink': '#ea76cb', '--sky': '#04a5e5', '--teal': '#179299',
  '--lavender': '#7287fd', '--rosewater': '#dc8a78',
  '--text-primary': '#4c4f69', '--text-secondary': '#6c6f85',
  '--text-muted': '#8c8fa1', '--text-subtle': '#7c7f92',
  '--text-inverse': '#eff1f5', '--text-overlay': '#5c5f77', '--text-surface': '#7c7f92',
  '--border-muted': '#ccd0da', '--border-hover': '#bcc0cc',
  '--border-subtle': '#9ca0b0', '--border-base': '#ccd0da',
}
// ── Apply theme to document root ───────────────────────────────────
export function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement
  const colors = theme === 'light' ? LIGHT_COLORS : DARK_COLORS
  Object.entries(colors).forEach(([k, v]) => root.style.setProperty(k, v))
  root.classList.toggle('light-theme', theme === 'light')
  root.classList.toggle('dark-theme', theme === 'dark')
}

export function applyFontSizes(uiFontSize: number, editorFontSize: number) {
  const root = document.documentElement
  root.style.setProperty('--ui-font-size', `${uiFontSize}px`)
  root.style.setProperty('--editor-font-size', `${editorFontSize}px`)
}

// ── Component ──────────────────────────────────────────────────────
export default function SettingsPanel({ isOpen, onClose, onOpenGuide, shortcutBindings, onUpdateShortcut, onResetShortcut, onResetAllShortcuts }: SettingsPanelProps) {
  const { t, language, setLanguage: setI18nLanguage } = useI18n()
  const [activeTab, setActiveTab] = useState<SettingsTab>('about')
  const [settings, setSettings] = useState<AppSettings>(loadSettings())

  // Apply settings on mount and when they change
  useEffect(() => {
    applyTheme(settings.theme)
    applyFontSizes(settings.uiFontSize, settings.editorFontSize)
    saveSettings(settings)
  }, [settings])

  // Keyboard shortcut to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    if (key === 'language') setI18nLanguage(value as Language)
  }, [setI18nLanguage])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="flex rounded-lg overflow-hidden shadow-2xl border border-border-muted bg-base"
        style={{ width: 780, height: 520 }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Left Sidebar ─────────────────────────────── */}
        <div className="w-48 flex-shrink-0 border-r border-border-muted flex flex-col py-4 bg-surface">
          <div className="px-4 mb-4">
            <h2 className="text-sm font-semibold text-text-primary">{t('settings.title')}</h2>
          </div>
          <nav className="flex-1 flex flex-col gap-0.5 px-2">
            {([
              { key: 'about',       label: t('settings.about'),       icon: AboutIcon },
              { key: 'appearance',  label: t('settings.appearance'),  icon: AppearanceIcon },
              { key: 'shortcuts',   label: t('settings.shortcuts'),   icon: ShortcutsIcon },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors text-left ${
                  activeTab === key
                    ? 'bg-muted text-text-primary'
                    : 'text-text-secondary hover:bg-muted/50 hover:text-text-primary'
                }`}
              >
                <Icon />
                {label}
              </button>
            ))}
          </nav>
          {/* Close button at bottom */}
          <div className="px-2 mt-auto pt-4">
            <button
              onClick={onClose}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-text-secondary hover:bg-muted hover:text-text-primary transition-colors"
            >
              <CloseIcon />
              {t('settings.close')}
            </button>
          </div>
        </div>

        {/* ── Right Content ────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6" style={{ fontSize: 'var(--ui-font-size, 14px)' }}>
          {activeTab === 'about' && <AboutSection settings={settings} updateSetting={updateSetting} onOpenGuide={onOpenGuide} />}
          {activeTab === 'appearance' && <AppearanceSection settings={settings} updateSetting={updateSetting} />}
          {activeTab === 'shortcuts' && (
            <ShortcutsSection
              bindings={shortcutBindings}
              onUpdate={onUpdateShortcut}
              onReset={onResetShortcut}
              onResetAll={onResetAllShortcuts}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── About Section ──────────────────────────────────────────────────
function AboutSection({ settings, updateSetting, onOpenGuide }: { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void; onOpenGuide?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-8">
      {/* Account */}
      <Section title={t('settings.account')}>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-text-inverse font-bold text-sm">
            U
          </div>
          <div>
            <div className="text-sm text-text-primary font-medium">{t('settings.localUser')}</div>
            <div className="text-xs text-text-secondary">{t('settings.localMode')}</div>
          </div>
        </div>
      </Section>

      {/* Language */}
      <Section title={t('settings.language')}>
        <div className="flex gap-2">
          {(['zh', 'en'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => updateSetting('language', lang)}
              className={`px-4 py-1.5 rounded text-sm transition-colors ${
                settings.language === lang
                  ? 'bg-accent text-text-inverse font-medium'
                  : 'bg-muted text-text-secondary hover:bg-hover'
              }`}
            >
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </Section>

      {/* Version */}
      <Section title={t('settings.version')}>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-primary">MiniObsidian</span>
          <span className="px-2 py-0.5 rounded text-xs bg-muted text-text-secondary">v0.1.0</span>
        </div>
      </Section>

      {/* Help */}
      <Section title={t('settings.help')}>
        <button
          onClick={() => {
            if (onOpenGuide) onOpenGuide()
          }}
          className="flex items-center gap-2 px-4 py-2 rounded bg-muted text-blue hover:bg-hover transition-colors text-sm"
        >
          <HelpIcon />
          {t('settings.getHelp')}
        </button>
      </Section>
    </div>
  )
}

// ── Appearance Section ─────────────────────────────────────────────
function AppearanceSection({ settings, updateSetting }: { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-8">
      {/* Theme */}
      <Section title={t('settings.theme')}>
        <div className="flex gap-3">
          {([
            { key: 'dark',  label: t('settings.dark'),  bg: '#1e1e2e', border: '#45475a' },
            { key: 'light', label: t('settings.light'), bg: '#eff1f5', border: '#ccd0da' },
          ] as const).map(({ key, label, bg, border }) => (
            <button
              key={key}
              onClick={() => updateSetting('theme', key)}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                settings.theme === key
                  ? 'border-accent'
                  : 'border-transparent hover:border-border-muted'
              }`}
              style={{ backgroundColor: bg }}
            >
              {/* Mini preview */}
              <div className="w-24 h-16 rounded overflow-hidden" style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                <div className="h-3" style={{ backgroundColor: key === 'dark' ? 'var(--bg-surface)' : 'var(--bg-surface)' }} />
                <div className="flex h-full">
                  <div className="w-5" style={{ backgroundColor: key === 'dark' ? 'var(--bg-overlay)' : 'var(--bg-overlay)' }} />
                  <div className="flex-1 p-1">
                    <div className="w-8 h-1 rounded mb-1" style={{ backgroundColor: 'var(--accent)' }} />
                    <div className="w-12 h-1 rounded" style={{ backgroundColor: 'var(--text-muted)' }} />
                  </div>
                </div>
              </div>
              <span className={`text-xs ${settings.theme === key ? 'text-accent font-medium' : key === 'dark' ? 'text-text-secondary' : 'text-text-overlay'}`}>
                {label}
              </span>
              {settings.theme === key && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent text-text-inverse flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </Section>

      {/* UI Font Size */}
      <Section title={t('settings.uiFontSize')}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => updateSetting('uiFontSize', Math.max(12, settings.uiFontSize - 1))}
            className="w-8 h-8 rounded bg-muted text-text-primary hover:bg-hover flex items-center justify-center transition-colors"
          >
            -
          </button>
          <div className="w-16 text-center text-sm text-text-primary">{settings.uiFontSize}px</div>
          <button
            onClick={() => updateSetting('uiFontSize', Math.min(20, settings.uiFontSize + 1))}
            className="w-8 h-8 rounded bg-muted text-text-primary hover:bg-hover flex items-center justify-center transition-colors"
          >
            +
          </button>
          <button
            onClick={() => updateSetting('uiFontSize', DEFAULT_SETTINGS.uiFontSize)}
            className="ml-2 px-3 py-1 rounded text-xs bg-muted text-text-secondary hover:bg-hover transition-colors"
          >
            {t('settings.reset')}
          </button>
        </div>
      </Section>

      {/* Editor Font Size */}
      <Section title={t('settings.editorFontSize')}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => updateSetting('editorFontSize', Math.max(12, settings.editorFontSize - 1))}
            className="w-8 h-8 rounded bg-muted text-text-primary hover:bg-hover flex items-center justify-center transition-colors"
          >
            -
          </button>
          <div className="w-16 text-center text-sm text-text-primary">{settings.editorFontSize}px</div>
          <button
            onClick={() => updateSetting('editorFontSize', Math.min(24, settings.editorFontSize + 1))}
            className="w-8 h-8 rounded bg-muted text-text-primary hover:bg-hover flex items-center justify-center transition-colors"
          >
            +
          </button>
          <button
            onClick={() => updateSetting('editorFontSize', DEFAULT_SETTINGS.editorFontSize)}
            className="ml-2 px-3 py-1 rounded text-xs bg-muted text-text-secondary hover:bg-hover transition-colors"
          >
            {t('settings.reset')}
          </button>
        </div>
      </Section>
    </div>
  )
}

// ── Shortcuts Section ──────────────────────────────────────────────
interface ShortcutsSectionProps {
  bindings?: Record<string, ShortcutBinding>
  onUpdate?: (id: string, newKeys: string) => void
  onReset?: (id: string) => void
  onResetAll?: () => void
}

function ShortcutsSection({ bindings, onUpdate, onReset, onResetAll }: ShortcutsSectionProps) {
  const { t } = useI18n()
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [conflictMsg, setConflictMsg] = useState<string | null>(null)
  const overrides = useRef(loadOverrides())

  // Recording handler: listens for next key combo
  useEffect(() => {
    if (!recordingId || !bindings) return

    const handleRecord = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Esc cancels recording
      if (e.key === 'Escape') {
        setRecordingId(null)
        setConflictMsg(null)
        return
      }

      // Ignore lone modifier keys
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      const combo = eventToCombo(e)
      if (!combo) return

      // Check for conflict
      const currentBinding = bindings[recordingId]
      if (currentBinding) {
        const conflict = detectConflict(combo, currentBinding.scope, bindings, recordingId)
        if (conflict) {
          setConflictMsg(t('shortcuts.conflict', { name: t(conflict.label as any) }))
          return
        }
      }

      // Save
      if (onUpdate) onUpdate(recordingId, combo)
      overrides.current = { ...overrides.current, [recordingId]: combo }
      setRecordingId(null)
      setConflictMsg(null)
    }

    window.addEventListener('keydown', handleRecord, true)
    return () => window.removeEventListener('keydown', handleRecord, true)
  }, [recordingId, bindings, onUpdate, t])

  if (!bindings) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <ShortcutsIcon />
        <p className="mt-3 text-sm">{t('settings.shortcutsComingSoon')}</p>
      </div>
    )
  }

  const currentOverrides = loadOverrides()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">{t('settings.shortcuts')}</h3>
        <button
          onClick={() => {
            if (onResetAll) {
              onResetAll()
              overrides.current = {}
              // Force re-render
              setRecordingId(null)
            }
          }}
          className="px-3 py-1 rounded text-xs bg-muted text-text-secondary hover:bg-hover transition-colors"
        >
          {t('shortcuts.resetAll')}
        </button>
      </div>

      {/* Tip */}
      <p className="text-xs text-text-muted">{t('shortcuts.tip')}</p>

      {/* Recording indicator */}
      {recordingId && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-accent/10 border border-accent/30 text-accent text-xs">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          {t('shortcuts.pressKeys')}
          {conflictMsg && <span className="text-red ml-2">{conflictMsg}</span>}
        </div>
      )}

      {/* Shortcut categories */}
      <div className="space-y-5 max-h-[320px] overflow-y-auto pr-1">
        {SHORTCUT_CATEGORIES.map(({ key: catKey, label: catLabel }) => {
          const catBindings = DEFAULT_SHORTCUTS.filter(b => b.category === catKey)
          if (catBindings.length === 0) return null

          return (
            <div key={catKey}>
              <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
                {t(catLabel as any)}
              </h4>
              <div className="space-y-0.5">
                {catBindings.map(binding => {
                  const effective = bindings[binding.id]
                  const isCustomized = currentOverrides[binding.id] != null
                  const isRecording = recordingId === binding.id

                  return (
                    <div
                      key={binding.id}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 group"
                    >
                      <span className="text-sm text-text-primary">
                        {t(binding.label as any)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isCustomized && (
                          <span className="text-[10px] text-accent mr-1">{t('shortcuts.customized')}</span>
                        )}
                        <button
                          onClick={() => {
                            setRecordingId(isRecording ? null : binding.id)
                            setConflictMsg(null)
                          }}
                          className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                            isRecording
                              ? 'border-accent bg-accent/10 text-accent animate-pulse'
                              : 'border-border-muted bg-muted text-text-secondary hover:border-accent hover:text-accent'
                          }`}
                        >
                          {isRecording ? t('shortcuts.pressKeys') : formatCombo(effective?.keys || binding.keys)}
                        </button>
                        {isCustomized && (
                          <button
                            onClick={() => {
                              if (onReset) onReset(binding.id)
                              delete overrides.current[binding.id]
                              // Force re-render
                              setRecordingId(null)
                            }}
                            className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-hover transition-all"
                            title={t('shortcuts.reset')}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                              <path d="M3 3v5h5" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Shared UI ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      {children}
    </div>
  )
}

// ── SVG Icons ──────────────────────────────────────────────────────
function AboutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

function AppearanceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function ShortcutsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" />
    </svg>
  )
}
