import { useRef, useEffect } from 'react'
import { useI18n } from '../../i18n'

export interface Tab {
  id: string
  title: string
  filePath: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose }: TabBarProps) {
  const { t } = useI18n()
  const tabBarRef = useRef<HTMLDivElement>(null)

  // Scroll active tab into view
  useEffect(() => {
    if (tabBarRef.current && activeTabId) {
      const activeEl = tabBarRef.current.querySelector(`[data-tab-id="${activeTabId}"]`)
      activeEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [activeTabId])

  if (tabs.length === 0) return null

  return (
    <div
      ref={tabBarRef}
      className="flex bg-surface border-b border-border-muted overflow-x-auto scrollbar-hide"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`
              group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer
              border-r border-border-muted min-w-0 max-w-[180px] flex-shrink-0
              transition-colors select-none
              ${isActive
                ? 'bg-base text-text-primary border-b-2 border-b-accent'
                : 'bg-surface text-text-muted hover:text-text-secondary hover:bg-base/50'
              }
            `}
            onClick={() => onTabClick(tab.id)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 opacity-60">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
              className={`
                flex-shrink-0 ml-1 p-0.5 rounded hover:bg-hover transition-opacity
                ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}
              `}
              title={t('tabBar.closeTab')}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
