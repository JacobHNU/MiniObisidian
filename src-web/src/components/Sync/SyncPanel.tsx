import { useState, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

interface SyncPanelProps {
  isOpen: boolean
  onClose: () => void
}

export default function SyncPanel({ isOpen, onClose }: SyncPanelProps) {
  const { t } = useI18n()
  const [syncTarget, setSyncTarget] = useState(localStorage.getItem('sync_target') || '')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<api.SyncResult | null>(null)
  const [changes, setChanges] = useState<api.FileChange[]>([])
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const handleSaveTarget = () => {
    localStorage.setItem('sync_target', syncTarget)
  }

  const handleScan = useCallback(async () => {
    if (!syncTarget) {
      setError(t('sync.setTargetFirst'))
      return
    }
    setScanning(true)
    setError(null)
    setChanges([])
    try {
      const detected = await api.getSyncChanges(syncTarget)
      setChanges(detected)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }, [syncTarget, t])

  const handleSync = useCallback(async () => {
    if (!syncTarget) {
      setError(t('sync.setTargetFirst'))
      return
    }
    setSyncing(true)
    setError(null)
    setResult(null)
    try {
      const syncResult = await api.runSync(syncTarget)
      setResult(syncResult)
      setChanges([])
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }, [syncTarget, t])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-base rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col border border-border-muted">
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
          {/* Sync target config */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">{t('sync.targetDir')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={syncTarget}
                onChange={e => setSyncTarget(e.target.value)}
                onBlur={handleSaveTarget}
                placeholder="e.g. D:\BaiduSync\MiniObsidian"
                className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue"
              />
              <button
                onClick={handleSaveTarget}
                className="px-3 py-1.5 text-xs bg-muted text-text-secondary rounded hover:bg-hover transition-colors"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              Set to a cloud-synced folder (e.g. Baidu Netdisk local sync dir)
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleScan}
              disabled={scanning || !syncTarget}
              className="flex-1 py-2 text-sm bg-muted text-text-secondary rounded hover:bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {scanning ? (
                <span className="inline-flex gap-1"><span className="animate-bounce">.</span><span className="animate-bounce" style={{animationDelay:'150ms'}}>.</span><span className="animate-bounce" style={{animationDelay:'300ms'}}>.</span></span>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  {t('sync.scanChanges')}
                </>
              )}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing || !syncTarget}
              className="flex-1 py-2 text-sm bg-blue text-text-inverse rounded hover:bg-lavender transition-colors disabled:opacity-50 font-medium flex items-center justify-center gap-2"
            >
              {syncing ? (
                <span className="inline-flex gap-1"><span className="animate-bounce">.</span><span className="animate-bounce" style={{animationDelay:'150ms'}}>.</span><span className="animate-bounce" style={{animationDelay:'300ms'}}>.</span></span>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3" />
                  </svg>
                  Sync Now
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red/10 border border-red/30 rounded-lg px-3 py-2 text-xs text-red">
              {error}
            </div>
          )}

          {/* Scan results */}
          {changes.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-secondary mb-2">{t('sync.pendingChanges', { count: changes.length })}</h3>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
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
            </div>
          )}

          {/* Sync result */}
          {result && (
            <div>
              <h3 className="text-xs font-semibold text-text-secondary mb-2">Sync Result</h3>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <div className="bg-surface rounded p-2 text-center">
                  <div className="text-lg font-bold text-green">{result.uploaded}</div>
                  <div className="text-[10px] text-text-muted">Uploaded</div>
                </div>
                <div className="bg-surface rounded p-2 text-center">
                  <div className="text-lg font-bold text-blue">{result.downloaded}</div>
                  <div className="text-[10px] text-text-muted">{t('sync.downloaded')}</div>
                </div>
                <div className="bg-surface rounded p-2 text-center">
                  <div className="text-lg font-bold text-red">{result.deleted}</div>
                  <div className="text-[10px] text-text-muted">Deleted</div>
                </div>
                <div className="bg-surface rounded p-2 text-center">
                  <div className="text-lg font-bold text-yellow">{result.conflicts}</div>
                  <div className="text-[10px] text-text-muted">Conflicts</div>
                </div>
              </div>
              {result.errors.length > 0 && (
                <div className="space-y-1">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red bg-red/10 rounded px-2 py-1">
                      {e.relativePath}: {e.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-text-muted mt-2">
                {t('sync.completedAt', { time: new Date(result.completedAt).toLocaleString() })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
