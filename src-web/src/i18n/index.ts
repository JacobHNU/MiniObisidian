import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import en, { type TranslationKey } from './locales/en'
import zh from './locales/zh'

export type { TranslationKey }

export type Language = 'zh' | 'en'

const translations: Record<Language, Record<TranslationKey, string>> = { en, zh }

interface I18nContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const STORAGE_KEY = 'miniobsidian_settings'

function getInitialLanguage(): Language {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.language === 'zh' || parsed.language === 'en') return parsed.language
    }
  } catch { /* ignore */ }
  return 'zh'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage)

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    // Persist to localStorage alongside other settings
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const settings = raw ? JSON.parse(raw) : {}
      settings.language = lang
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch { /* ignore */ }
  }, [])

  const t = useCallback((key: TranslationKey, params?: Record<string, string | number>): string => {
    let text = translations[language][key] ?? translations.en[key] ?? key
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      })
    }
    return text
  }, [language])

  return React.createElement(
    I18nContext.Provider,
    { value: { language, setLanguage, t } },
    children
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
