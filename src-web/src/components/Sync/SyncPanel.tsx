import { useState, useEffect, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

interface SyncPanelProps {
  isOpen: boolean
  onClose: () => void
  onSyncStatusChange?: (status: 'idle' | 'syncing' | 'error' | 'pending') => void
}

export default function SyncPanel({ isOpen, onClose, onSyncStatusChange }: SyncPanelProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<api.SyncConfig | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [result, setResult] = useState<api.SyncResult | null>(null)
  const [changes, setChanges] = useState<api.FileChange[]>([])
  const [error, setError] = useState<string | null>(null)
  const [statusInfo, setStatusInfo] = useState<{ pendingChanges: number; lastSync: string | null } | null>(null)
  const [history, setHistory] = useState<Array<{ time: string; result: api.SyncResult }>>([])

  // Load config on open
  useEffect(() => {
    if (!isOpen) return
    api.getSyncConfig().then(setConfig).catch(() => setConfig({
      includePatterns: ['*.md', 'attachments/*'],
      excludePatterns: [],
      maxFileSize: 10 * 1024 * 1024,
      excludeDirs: ['node_modules', '.git'],
      autoSyncEnabled: false,
      autoSyncIntervalMinutes: 5,
      checkNetwork: true,
      conflictStrategy: 'keep_newer',
      syncTarget: '',
    }))
    api.getSyncStatus().then(setStatusInfo).catch(() => {})
  }, [isOpen])

  const saveConfig = useCallback(async (updated: api.SyncConfig) => {
    setConfig(updated)
    try {
      await api.setSyncConfig(updated)
      // Also update legacy sync target if changed
      if (updated.syncTarget) {
        await api.configureSync(updated.syncTarget)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const handleScan = useCallback(async () => {
    if (!config?.syncTarget) {
      setError(t('sync.setTargetFirst'))
      return
    }
    setScanning(true)
    setError(null)
    setChanges([])
    try {
      const detected = await api.getSyncChanges()
      setChanges(detected)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }, [config?.syncTarget, t])

  const handleSync = useCallback(async () => {
    if (!config?.syncTarget) {
      setError(t('sync.setTargetFirst'))
      return
    }
    setSyncing(true)
    setError(null)
    setResult(null)
    onSyncStatusChange?.('syncing')
    try {
      const syncResult = await api.runSync()
      setResult(syncResult)
      setChanges([])
      setHistory(prev => [{ time: new Date().toLocaleTimeString(), result: syncResult }, ...prev].slice(0, 10))
      // Update status
      const status = await api.getSyncStatus()
      setStatusInfo(status)
      onSyncStatusChange?.(syncResult.errors.length > 0 ? 'error' : 'idle')
    } catch (e) {
      setError(String(e))
      onSyncStatusChange?.('error')
    } finally {
      setSyncing(false)
    }
  }, [config?.syncTarget, t, onSyncStatusChange])

  const handleFullPull = useCallback(async () => {
    if (!config?.syncTarget) {
      setError(t('sync.setTargetFirst'))
      return
    }
    setPulling(true)
    setError(null)
    onSyncStatusChange?.('syncing')
    try {
      const pullResult = await api.fullPull()
      setResult(pullResult)
      setHistory(prev => [{ time: new Date().toLocaleTimeString(), result: pullResult }, ...prev].slice(0, 10))
      const status = await api.getSyncStatus()
      setStatusInfo(status)
      onSyncStatusChange?.('idle')
    } catch (e) {
      setError(String(e))
      onSyncStatusChange?.('error')
    } finally {
      setPulling(false)
    }
  }, [config?.syncTarget, t, onSyncStatusChange])

  if (!isOpen || !config) return null

  const syncStatusColor = error ? 'text-red' : syncing ? 'text-blue' : (statusInfo?.pendingChanges ?? 0) > 0 ? 'text-yellow' : 'text-green'
  const syncStatusText = error ? t('sync.statusError') : syncing ? t('sync.statusSyncing') : (statusInfo?.pendingChanges ?? 0) > 0 ? t('sync.statusPending') : t('sync.statusSynced')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-base rounded-lg shadow-xl w-[560px] max-h-[85vh] flex flex-col border border-border-muted">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue">
              <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
            </svg>
            <span className="text-sm font-semibold text-text-primary">Cloud Sync</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-red">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Status */}
          <div className="bg-surface rounded-lg px-3 py-2 border border-border-muted">
            <div className="flex items-center gap-2">
              <span className={`text-lg ${syncStatusColor}`}>●</span>
              <span className="text-sm font-medium text-text-primary">{syncStatusText}</span>
              <span className="ml-auto text-xs text-text-muted">
                {t('sync.pending')}: {statusInfo?.pendingChanges ?? 0}
              </span>
            </div>
            {statusInfo?.lastSync && (
              <div className="text-xs text-text-muted mt-1">
                {t('sync.lastSync')}: {new Date(statusInfo.lastSync).toLocaleString()}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing || !config.syncTarget}
              className="flex-1 py-2 text-sm bg-blue text-text-inverse rounded hover:bg-lavender transition-colors disabled:opacity-50 font-medium flex items-center justify-center gap-2"
            >
              {syncing ? <LoadingDots /> : t('sync.syncNow')}
            </button>
            <button
              onClick={handleScan}
              disabled={scanning || !config.syncTarget}
              className="flex-1 py-2 text-sm bg-muted text-text-secondary rounded hover:bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {scanning ? <LoadingDots /> : t('sync.scanChanges')}
            </button>
            <button
              onClick={handleFullPull}
              disabled={pulling || !config.syncTarget}
              className="flex-1 py-2 text-sm bg-muted text-text-secondary rounded hover:bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {pulling ? <LoadingDots /> : t('sync.fullPull')}
            </button>
          </div>

          {/* Sync Config */}
          <Section title={t('sync.config')}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('sync.targetDir')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.syncTarget}
                    onChange={e => saveConfig({ ...config, syncTarget: e.target.value })}
                    placeholder="D:\BaiduSync\MiniObsidian"
                    className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const { open } = await import('@tauri-apps/plugin-dialog')
                        const selected = await open({
                          directory: true,
                          multiple: false,
                          title: t('sync.selectFolder'),
                        })
                        if (selected) {
                          saveConfig({ ...config, syncTarget: selected as string })
                        }
                      } catch (e) {
                        console.error('Folder dialog failed:', e)
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                  >
                    {t('sync.browse')}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto-sync"
                  checked={config.autoSyncEnabled}
                  onChange={e => saveConfig({ ...config, autoSyncEnabled: e.target.checked })}
                  className="accent-blue"
                />
                <label htmlFor="auto-sync" className="text-xs text-text-secondary">{t('sync.autoSync')}</label>
              </div>
              {config.autoSyncEnabled && (
                <div className="flex items-center gap-2 ml-5">
                  <label className="text-xs text-text-secondary">{t('sync.interval')}</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={config.autoSyncIntervalMinutes}
                    onChange={e => saveConfig({ ...config, autoSyncIntervalMinutes: Number(e.target.value) })}
                    className="w-16 px-2 py-1 text-sm bg-muted border border-border-hover rounded text-text-primary text-center focus:outline-none focus:border-blue"
                  />
                  <span className="text-xs text-text-muted">{t('sync.minutes')}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="check-network"
                  checked={config.checkNetwork}
                  onChange={e => saveConfig({ ...config, checkNetwork: e.target.checked })}
                  className="accent-blue"
                />
                <label htmlFor="check-network" className="text-xs text-text-secondary">{t('sync.checkNetwork')}</label>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary">{t('sync.conflictStrategy')}</label>
                <select
                  value={config.conflictStrategy}
                  onChange={e => saveConfig({ ...config, conflictStrategy: e.target.value })}
                  className="px-2 py-1 text-sm bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-blue"
                >
                  <option value="keep_newer">{t('sync.keepNewer')}</option>
                  <option value="keep_local">{t('sync.keepLocal')}</option>
                  <option value="keep_remote">{t('sync.keepRemote')}</option>
                  <option value="keep_both">{t('sync.keepBoth')}</option>
                </select>
              </div>
            </div>
          </Section>

          {/* Selective Sync */}
          <Section title={t('sync.selectiveSync')}>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('sync.maxFileSize')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={Math.round(config.maxFileSize / 1024 / 1024)}
                    onChange={e => saveConfig({ ...config, maxFileSize: Number(e.target.value) * 1024 * 1024 })}
                    className="w-20 px-2 py-1 text-sm bg-muted border border-border-hover rounded text-text-primary text-center focus:outline-none focus:border-blue"
                  />
                  <span className="text-xs text-text-muted">MB (0 = {t('sync.noLimit')})</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('sync.excludeDirs')}</label>
                <input
                  type="text"
                  value={config.excludeDirs.join(', ')}
                  onChange={e => saveConfig({ ...config, excludeDirs: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary focus:outline-none focus:border-blue"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('sync.excludePatterns')}</label>
                <input
                  type="text"
                  value={config.excludePatterns.join(', ')}
                  onChange={e => saveConfig({ ...config, excludePatterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="*.pdf, *.zip"
                  className="w-full px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue"
                />
              </div>
            </div>
          </Section>

          {/* Error */}
          {error && (
            <div className="bg-red/10 border border-red/30 rounded-lg px-3 py-2 text-xs text-red">
              {error}
            </div>
          )}

          {/* Scan results */}
          {changes.length > 0 && (
            <Section title={t('sync.pendingChanges', { count: changes.length })}>
              <div className="space-y-1 max-h-[150px] overflow-y-auto">
                {changes.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 bg-surface rounded text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      c.changeType === 'Added' ? 'bg-green/20 text-green' :
                      c.changeType === 'Modified' ? 'bg-yellow/20 text-yellow' :
                      'bg-red/20 text-red'
                    }`}>
                      {c.changeType}
                    </span>
                    <span className="text-text-primary truncate">{c.relativePath}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Sync result */}
          {result && (
            <Section title={t('sync.result')}>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <StatCard value={result.uploaded} label={t('sync.uploaded')} color="text-green" />
                <StatCard value={result.downloaded} label={t('sync.downloaded')} color="text-blue" />
                <StatCard value={result.deleted} label={t('sync.deleted')} color="text-red" />
                <StatCard value={result.conflicts} label={t('sync.conflicts')} color="text-yellow" />
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1 mt-2">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red bg-red/10 rounded px-2 py-1">
                      {e.relativePath}: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Sync History */}
          {history.length > 0 && (
            <Section title={t('sync.history')}>
              <div className="space-y-1 max-h-[120px] overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs px-2 py-1">
                    <span>{h.result.errors.length > 0 ? '⚠️' : '✅'}</span>
                    <span className="text-text-muted">{h.time}</span>
                    <span className="text-green">↑{h.result.uploaded}</span>
                    <span className="text-blue">↓{h.result.downloaded}</span>
                    {h.result.conflicts > 0 && <span className="text-yellow">⚡{h.result.conflicts}</span>}
                    {h.result.errors.length > 0 && <span className="text-red">✕{h.result.errors.length}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-blue mb-2">{title}</h3>
      <div className="bg-surface rounded-lg px-3 py-2 border border-border-muted">
        {children}
      </div>
    </div>
  )
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="bg-muted rounded p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="animate-bounce">.</span>
      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
    </span>
  )
}
