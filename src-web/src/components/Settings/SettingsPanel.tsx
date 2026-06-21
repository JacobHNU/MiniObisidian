import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────
type SettingsTab = 'about' | 'appearance' | 'shortcuts'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

// ── Theme / Font persistence helpers ───────────────────────────────
const STORAGE_KEY = 'miniobsidian_settings'

interface AppSettings {
  theme: 'dark' | 'light'
  uiFontSize: number      // global UI font size (px)
  editorFontSize: number  // note content font size (px)
  language: 'zh' | 'en'
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  uiFontSize: 14,
  editorFontSize: 15,
  language: 'zh',
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(s: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ── Apply theme to document root ───────────────────────────────────
function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement
  if (theme === 'light') {
    root.classList.add('light-theme')
    root.classList.remove('dark-theme')
  } else {
    root.classList.add('dark-theme')
    root.classList.remove('light-theme')
  }
}

function applyFontSizes(uiFontSize: number, editorFontSize: number) {
  const root = document.documentElement
  root.style.setProperty('--ui-font-size', `${uiFontSize}px`)
  root.style.setProperty('--editor-font-size', `${editorFontSize}px`)
}

// ── Component ──────────────────────────────────────────────────────
export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('about')
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

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
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="flex rounded-lg overflow-hidden shadow-2xl border border-[#45475a]"
        style={{ width: 780, height: 520, backgroundColor: '#1e1e2e' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Left Sidebar ─────────────────────────────── */}
        <div className="w-48 flex-shrink-0 border-r border-[#313244] flex flex-col py-4" style={{ backgroundColor: '#181825' }}>
          <div className="px-4 mb-4">
            <h2 className="text-sm font-semibold text-[#cdd6f4]">Settings</h2>
          </div>
          <nav className="flex-1 flex flex-col gap-0.5 px-2">
            {([
              { key: 'about',       label: 'About',       icon: AboutIcon },
              { key: 'appearance',  label: 'Appearance',  icon: AppearanceIcon },
              { key: 'shortcuts',   label: 'Shortcuts',   icon: ShortcutsIcon },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors text-left ${
                  activeTab === key
                    ? 'bg-[#313244] text-[#cdd6f4]'
                    : 'text-[#a6adc8] hover:bg-[#313244]/50 hover:text-[#cdd6f4]'
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
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-[#a6adc8] hover:bg-[#313244] hover:text-[#cdd6f4] transition-colors"
            >
              <CloseIcon />
              Close
            </button>
          </div>
        </div>

        {/* ── Right Content ────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6" style={{ fontSize: 'var(--ui-font-size, 14px)' }}>
          {activeTab === 'about' && <AboutSection settings={settings} updateSetting={updateSetting} />}
          {activeTab === 'appearance' && <AppearanceSection settings={settings} updateSetting={updateSetting} />}
          {activeTab === 'shortcuts' && <ShortcutsSection />}
        </div>
      </div>
    </div>
  )
}

// ── About Section ──────────────────────────────────────────────────
function AboutSection({ settings, updateSetting }: { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  return (
    <div className="space-y-8">
      {/* Account */}
      <Section title="Account">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[#313244]/50">
          <div className="w-10 h-10 rounded-full bg-[#cba6f7] flex items-center justify-center text-[#1e1e2e] font-bold text-sm">
            U
          </div>
          <div>
            <div className="text-sm text-[#cdd6f4] font-medium">Local User</div>
            <div className="text-xs text-[#a6adc8]">Local mode - no login required</div>
          </div>
        </div>
      </Section>

      {/* Language */}
      <Section title="Language">
        <div className="flex gap-2">
          {(['zh', 'en'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => updateSetting('language', lang)}
              className={`px-4 py-1.5 rounded text-sm transition-colors ${
                settings.language === lang
                  ? 'bg-[#cba6f7] text-[#1e1e2e] font-medium'
                  : 'bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]'
              }`}
            >
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </Section>

      {/* Version */}
      <Section title="Version">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#cdd6f4]">MiniObsidian</span>
          <span className="px-2 py-0.5 rounded text-xs bg-[#313244] text-[#a6adc8]">v0.1.0</span>
        </div>
      </Section>

      {/* Help */}
      <Section title="Help">
        <button
          onClick={() => {
            // Open a built-in help/tutorial page (could be a local HTML or external URL)
            window.open('https://github.com/miniobsidian/help', '_blank')
          }}
          className="flex items-center gap-2 px-4 py-2 rounded bg-[#313244] text-[#89b4fa] hover:bg-[#45475a] transition-colors text-sm"
        >
          <HelpIcon />
          Get Help
        </button>
      </Section>
    </div>
  )
}

// ── Appearance Section ─────────────────────────────────────────────
function AppearanceSection({ settings, updateSetting }: { settings: AppSettings; updateSetting: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void }) {
  return (
    <div className="space-y-8">
      {/* Theme */}
      <Section title="Theme">
        <div className="flex gap-3">
          {([
            { key: 'dark',  label: 'Dark',  bg: '#1e1e2e', border: '#45475a' },
            { key: 'light', label: 'Light', bg: '#eff1f5', border: '#ccd0da' },
          ] as const).map(({ key, label, bg, border }) => (
            <button
              key={key}
              onClick={() => updateSetting('theme', key)}
              className={`relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors ${
                settings.theme === key
                  ? 'border-[#cba6f7]'
                  : 'border-transparent hover:border-[#45475a]'
              }`}
              style={{ backgroundColor: bg }}
            >
              {/* Mini preview */}
              <div className="w-24 h-16 rounded overflow-hidden" style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                <div className="h-3" style={{ backgroundColor: key === 'dark' ? '#181825' : '#e6e9ef' }} />
                <div className="flex h-full">
                  <div className="w-5" style={{ backgroundColor: key === 'dark' ? '#11111b' : '#dce0e8' }} />
                  <div className="flex-1 p-1">
                    <div className="w-8 h-1 rounded mb-1" style={{ backgroundColor: key === 'dark' ? '#cba6f7' : '#8839ef' }} />
                    <div className="w-12 h-1 rounded" style={{ backgroundColor: key === 'dark' ? '#6c7086' : '#9ca0b0' }} />
                  </div>
                </div>
              </div>
              <span className={`text-xs ${settings.theme === key ? 'text-[#cba6f7] font-medium' : key === 'dark' ? 'text-[#a6adc8]' : 'text-[#5c5f77]'}`}>
                {label}
              </span>
              {settings.theme === key && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#cba6f7] flex items-center justify-center">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1e1e2e" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
              )}
            </button>
          ))}
        </div>
      </Section>

      {/* UI Font Size */}
      <Section title="Interface Font Size">
        <div className="flex items-center gap-4">
          <button
            onClick={() => updateSetting('uiFontSize', Math.max(12, settings.uiFontSize - 1))}
            className="w-8 h-8 rounded bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a] flex items-center justify-center transition-colors"
          >
            -
          </button>
          <div className="w-16 text-center text-sm text-[#cdd6f4]">{settings.uiFontSize}px</div>
          <button
            onClick={() => updateSetting('uiFontSize', Math.min(20, settings.uiFontSize + 1))}
            className="w-8 h-8 rounded bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a] flex items-center justify-center transition-colors"
          >
            +
          </button>
          <button
            onClick={() => updateSetting('uiFontSize', DEFAULT_SETTINGS.uiFontSize)}
            className="ml-2 px-3 py-1 rounded text-xs bg-[#313244] text-[#a6adc8] hover:bg-[#45475a] transition-colors"
          >
            Reset
          </button>
        </div>
      </Section>

      {/* Editor Font Size */}
      <Section title="Editor Font Size">
        <div className="flex items-center gap-4">
          <button
            onClick={() => updateSetting('editorFontSize', Math.max(12, settings.editorFontSize - 1))}
            className="w-8 h-8 rounded bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a] flex items-center justify-center transition-colors"
          >
            -
          </button>
          <div className="w-16 text-center text-sm text-[#cdd6f4]">{settings.editorFontSize}px</div>
          <button
            onClick={() => updateSetting('editorFontSize', Math.min(24, settings.editorFontSize + 1))}
            className="w-8 h-8 rounded bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a] flex items-center justify-center transition-colors"
          >
            +
          </button>
          <button
            onClick={() => updateSetting('editorFontSize', DEFAULT_SETTINGS.editorFontSize)}
            className="ml-2 px-3 py-1 rounded text-xs bg-[#313244] text-[#a6adc8] hover:bg-[#45475a] transition-colors"
          >
            Reset
          </button>
        </div>
      </Section>
    </div>
  )
}

// ── Shortcuts Section ──────────────────────────────────────────────
function ShortcutsSection() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[#6c7086]">
      <ShortcutsIcon />
      <p className="mt-3 text-sm">Shortcuts settings coming soon</p>
    </div>
  )
}

// ── Shared UI ──────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#cdd6f4] mb-3">{title}</h3>
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
