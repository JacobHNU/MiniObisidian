import { useState, useEffect, useCallback } from 'react'
import * as api from '../../ipc/tauri'
import { useI18n } from '../../i18n'

type SyncTargetType = 'local' | 'baidu'

interface SyncPanelProps {
  isOpen: boolean
  onClose: () => void
  onSyncStatusChange?: (status: 'idle' | 'syncing' | 'error' | 'pending') => void
}

export default function SyncPanel({ isOpen, onClose, onSyncStatusChange }: SyncPanelProps) {
  const { t } = useI18n()
  const [config, setConfig] = useState<api.SyncConfig | null>(null)
  const [targetType, setTargetType] = useState<SyncTargetType>('local')
  const [syncing, setSyncing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [result, setResult] = useState<api.SyncResult | null>(null)
  const [changes, setChanges] = useState<api.FileChange[]>([])
  const [error, setError] = useState<string | null>(null)
  const [statusInfo, setStatusInfo] = useState<{ pendingChanges: number; lastSync: string | null } | null>(null)
  const [history, setHistory] = useState<Array<{ time: string; result: api.SyncResult }>>([])

  // Baidu Pan state
  const [baiduAppKey, setBaiduAppKey] = useState('')
  const [baiduSecretKey, setBaiduSecretKey] = useState('')
  const [baiduConnecting, setBaiduConnecting] = useState(false)
  const [baiduConnection, setBaiduConnection] = useState<api.BaiduConnectionInfo | null>(null)
  const [baiduAuthCode, setBaiduAuthCode] = useState('')
  const [baiduAuthUrl, setBaiduAuthUrl] = useState<string | null>(null)
  const [baiduKeysSaved, setBaiduKeysSaved] = useState(false)
  const [baiduKeysExpanded, setBaiduKeysExpanded] = useState(false)
  const [baiduShowGuide, setBaiduShowGuide] = useState(false)

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

  // Check Baidu connection when switching to baidu tab
  useEffect(() => {
    if (!isOpen || targetType !== 'baidu') return
    checkBaiduConnection()
  }, [isOpen, targetType])

  const checkBaiduConnection = useCallback(async () => {
    try {
      const info = await api.baiduCheckConnection()
      setBaiduConnection(info)
      if (info.connected) {
        setBaiduKeysSaved(true)
      }
    } catch {
      setBaiduConnection(null)
    }
  }, [])

  const saveConfig = useCallback(async (updated: api.SyncConfig) => {
    setConfig(updated)
    try {
      await api.setSyncConfig(updated)
      if (updated.syncTarget) {
        await api.configureSync(updated.syncTarget)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [])

  // ── Baidu Pan Handlers ──────────────────────────────

  const handleSaveBaiduKeys = useCallback(async () => {
    if (!baiduAppKey.trim() || !baiduSecretKey.trim()) {
      setError(t('sync.baidu.noKeys'))
      return
    }
    setError(null)
    try {
      await api.baiduInitAdapter(baiduAppKey.trim(), baiduSecretKey.trim())
      setBaiduKeysSaved(true)
      setBaiduKeysExpanded(false)
    } catch (e) {
      setError(String(e))
    }
  }, [baiduAppKey, baiduSecretKey, t])

  const handleOpenAuthPage = useCallback(async () => {
    if (!baiduKeysSaved) {
      setError(t('sync.baidu.noKeys'))
      return
    }
    setError(null)
    try {
      const url = await api.baiduGetAuthUrl('oob')
      setBaiduAuthUrl(url)
      // Open the auth URL in the default browser
      window.open(url, '_blank')
    } catch (e) {
      setError(String(e))
    }
  }, [baiduKeysSaved, t])

  const handleSubmitAuthCode = useCallback(async () => {
    if (!baiduAuthCode.trim()) return
    setBaiduConnecting(true)
    setError(null)
    try {
      await api.baiduExchangeCode(baiduAuthCode.trim(), 'oob')
      setBaiduAuthCode('')
      setBaiduAuthUrl(null)
      // Check connection after successful auth
      await checkBaiduConnection()
    } catch (e) {
      setError(String(e))
    } finally {
      setBaiduConnecting(false)
    }
  }, [baiduAuthCode, checkBaiduConnection])

  const handleBaiduDisconnect = useCallback(async () => {
    try {
      await api.baiduLogout()
      setBaiduConnection(null)
      setBaiduKeysSaved(false)
      setBaiduAppKey('')
      setBaiduSecretKey('')
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const handleBaiduRefreshToken = useCallback(async () => {
    try {
      await api.baiduRefreshToken()
      await checkBaiduConnection()
    } catch (e) {
      setError(String(e))
    }
  }, [checkBaiduConnection])

  // ── Sync Operations ──────────────────────────────────

  const isReady = targetType === 'local' ? !!config?.syncTarget : !!baiduConnection?.connected

  const handleScan = useCallback(async () => {
    if (!isReady) {
      setError(targetType === 'local' ? t('sync.setTargetFirst') : t('sync.baidu.notConnected'))
      return
    }
    setScanning(true)
    setError(null)
    setChanges([])
    try {
      let detected: api.FileChange[]
      if (targetType === 'baidu') {
        const vaultPath = await api.getVaultPath()
        if (!vaultPath) { setError(t('sync.vaultNotInitialized')); return }
        detected = await api.baiduGetChanges(vaultPath, JSON.stringify(config))
      } else {
        detected = await api.getSyncChanges()
      }
      setChanges(detected)
    } catch (e) {
      setError(String(e))
    } finally {
      setScanning(false)
    }
  }, [isReady, targetType, config, t])

  const handleSync = useCallback(async () => {
    if (!isReady) {
      setError(targetType === 'local' ? t('sync.setTargetFirst') : t('sync.baidu.notConnected'))
      return
    }
    setSyncing(true)
    setError(null)
    setResult(null)
    onSyncStatusChange?.('syncing')
    try {
      let syncResult: api.SyncResult
      if (targetType === 'baidu') {
        const vaultPath = await api.getVaultPath()
        if (!vaultPath) { setError(t('sync.vaultNotInitialized')); return }
        const rawResult = await api.baiduRunSync(vaultPath, JSON.stringify(config))
        syncResult = toSyncResult(rawResult)
      } else {
        syncResult = await api.runSync()
      }
      setResult(syncResult)
      setChanges([])
      setHistory(prev => [{ time: new Date().toLocaleTimeString(), result: syncResult }, ...prev].slice(0, 10))
      const status = await api.getSyncStatus()
      setStatusInfo(status)
      onSyncStatusChange?.(syncResult.errors.length > 0 ? 'error' : 'idle')
    } catch (e) {
      setError(String(e))
      onSyncStatusChange?.('error')
    } finally {
      setSyncing(false)
    }
  }, [isReady, targetType, config, t, onSyncStatusChange])

  const handleFullPull = useCallback(async () => {
    if (!isReady) {
      setError(targetType === 'local' ? t('sync.setTargetFirst') : t('sync.baidu.notConnected'))
      return
    }
    setPulling(true)
    setError(null)
    onSyncStatusChange?.('syncing')
    try {
      let pullResult: api.SyncResult
      if (targetType === 'baidu') {
        // For Baidu, baidu_run_sync already handles bidirectional sync
        const vaultPath = await api.getVaultPath()
        if (!vaultPath) { setError(t('sync.vaultNotInitialized')); return }
        const rawResult = await api.baiduRunSync(vaultPath, JSON.stringify(config))
        pullResult = toSyncResult(rawResult)
      } else {
        pullResult = await api.fullPull()
      }
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
  }, [isReady, targetType, config, t, onSyncStatusChange])

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
            <span className="text-sm font-semibold text-text-primary">{t('sync.title')}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-text-secondary hover:text-red">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Sync Target Type Selector */}
          <div className="flex rounded-lg border border-border-muted overflow-hidden">
            <button
              onClick={() => setTargetType('local')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                targetType === 'local'
                  ? 'bg-blue text-text-inverse'
                  : 'bg-surface text-text-secondary hover:bg-hover'
              }`}
            >
              {t('sync.targetLocal')}
            </button>
            <button
              onClick={() => setTargetType('baidu')}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                targetType === 'baidu'
                  ? 'bg-blue text-text-inverse'
                  : 'bg-surface text-text-secondary hover:bg-hover'
              }`}
            >
              {t('sync.targetBaidu')}
            </button>
          </div>

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
              disabled={syncing || !isReady}
              className="flex-1 py-2 text-sm bg-blue text-text-inverse rounded hover:bg-lavender transition-colors disabled:opacity-50 font-medium flex items-center justify-center gap-2"
            >
              {syncing ? <LoadingDots /> : t('sync.syncNow')}
            </button>
            <button
              onClick={handleScan}
              disabled={scanning || !isReady}
              className="flex-1 py-2 text-sm bg-muted text-text-secondary rounded hover:bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {scanning ? <LoadingDots /> : t('sync.scanChanges')}
            </button>
            <button
              onClick={handleFullPull}
              disabled={pulling || !isReady}
              className="flex-1 py-2 text-sm bg-muted text-text-secondary rounded hover:bg-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {pulling ? <LoadingDots /> : t('sync.fullPull')}
            </button>
          </div>

          {/* ── Local Folder Config ─────────────────────────── */}
          {targetType === 'local' && (
            <>
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
            </>
          )}

          {/* ── Baidu Pan Connection ────────────────────────── */}
          {targetType === 'baidu' && (
            <Section title={t('sync.baidu.title')}>
              <div className="space-y-3">
                {/* Connection Status */}
                {baiduConnection?.connected ? (
                  <div className="bg-green/10 border border-green/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-green text-lg">●</span>
                      <span className="text-sm font-medium text-green">{t('sync.baidu.connected')}</span>
                    </div>
                    {/* User Info */}
                    {baiduConnection.baiduName && (
                      <div className="space-y-1 text-xs text-text-secondary ml-5">
                        <div>{t('sync.baidu.name')}: {baiduConnection.baiduName}</div>
                        {baiduConnection.totalSpace != null && baiduConnection.usedSpace != null && (
                          <div>
                            {t('sync.baidu.spaceUsed')}: {formatBytes(baiduConnection.usedSpace)} {t('sync.baidu.of')} {formatBytes(baiduConnection.totalSpace)}
                            <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue rounded-full transition-all"
                                style={{ width: `${Math.min(100, (baiduConnection.usedSpace / baiduConnection.totalSpace) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleBaiduRefreshToken}
                        className="px-3 py-1 text-xs bg-muted text-text-secondary rounded hover:bg-hover transition-colors"
                      >
                        {t('sync.baidu.authorize')}
                      </button>
                      <button
                        onClick={handleBaiduDisconnect}
                        className="px-3 py-1 text-xs bg-red/10 text-red rounded hover:bg-red/20 transition-colors"
                      >
                        {t('sync.baidu.disconnect')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Not Connected State */}
                    <div className="text-xs text-text-muted">
                      {t('sync.baidu.notConnected')}
                    </div>

                    {/* API Key Settings */}
                    <div className="border border-border-muted rounded-lg">
                      <button
                        onClick={() => setBaiduKeysExpanded(!baiduKeysExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-text-secondary hover:bg-hover transition-colors"
                      >
                        <span>{t('sync.baidu.apiSettings')}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          className={`transition-transform ${baiduKeysExpanded ? 'rotate-180' : ''}`}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {baiduKeysExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-border-muted">
                          <div className="mt-2">
                            <label className="block text-xs text-text-secondary mb-1">{t('sync.baidu.appKey')}</label>
                            <input
                              type="text"
                              value={baiduAppKey}
                              onChange={e => setBaiduAppKey(e.target.value)}
                              placeholder={t('sync.baidu.appKeyPlaceholder')}
                              className="w-full px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('sync.baidu.secretKey')}</label>
                            <input
                              type="password"
                              value={baiduSecretKey}
                              onChange={e => setBaiduSecretKey(e.target.value)}
                              placeholder={t('sync.baidu.secretKeyPlaceholder')}
                              className="w-full px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue font-mono"
                            />
                          </div>
                          <button
                            onClick={handleSaveBaiduKeys}
                            className="w-full py-1.5 text-xs bg-blue text-text-inverse rounded hover:bg-lavender transition-colors font-medium"
                          >
                            {t('sync.baidu.saveKeys')}
                          </button>
                          {/* How to get keys guide */}
                          <button
                            onClick={() => setBaiduShowGuide(!baiduShowGuide)}
                            className="text-xs text-blue hover:underline"
                          >
                            {t('sync.baidu.howToGetKeys')}
                          </button>
                          {baiduShowGuide && (
                            <div className="text-xs text-text-muted bg-muted rounded px-2 py-1.5">
                              {t('sync.baidu.getKeysGuide')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Authorization Flow */}
                    {baiduKeysSaved && (
                      <div className="space-y-2">
                        <div className="text-xs text-text-muted">
                          {t('sync.baidu.authorizeDesc')}
                        </div>
                        {!baiduAuthUrl ? (
                          <button
                            onClick={handleOpenAuthPage}
                            className="w-full py-2 text-sm bg-blue text-text-inverse rounded hover:bg-lavender transition-colors font-medium"
                          >
                            {t('sync.baidu.openAuthPage')}
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <label className="block text-xs text-text-secondary">{t('sync.baidu.authCode')}</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={baiduAuthCode}
                                onChange={e => setBaiduAuthCode(e.target.value)}
                                placeholder={t('sync.baidu.authCodePlaceholder')}
                                className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border-hover rounded text-text-primary placeholder-text-muted focus:outline-none focus:border-blue font-mono"
                                onKeyDown={e => { if (e.key === 'Enter') handleSubmitAuthCode() }}
                              />
                              <button
                                onClick={handleSubmitAuthCode}
                                disabled={baiduConnecting || !baiduAuthCode.trim()}
                                className="px-3 py-1.5 text-sm bg-green text-text-inverse rounded hover:opacity-90 transition-colors disabled:opacity-50 font-medium flex items-center gap-1"
                              >
                                {baiduConnecting ? <LoadingDots /> : t('sync.baidu.submitCode')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Conflict strategy (also applicable for Baidu) */}
                {baiduConnection?.connected && (
                  <div className="flex items-center gap-2 pt-1">
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
                )}
              </div>
            </Section>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red/10 border border-red/30 rounded-lg px-3 py-2 text-xs text-red flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red hover:opacity-70 flex-shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
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
                      c.changeType === 'Download' ? 'bg-blue/20 text-blue' :
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
                    <span>{h.result.errors.length > 0 ? '⚠' : '✓'}</span>
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

// ── Helper Components ───────────────────────────────────

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function toSyncResult(raw: api.BaiduSyncResult): api.SyncResult {
  const total = (raw.uploaded ?? 0) + (raw.downloaded ?? 0) + (raw.deleted ?? 0)
  return {
    totalChanges: total,
    uploaded: raw.uploaded ?? 0,
    downloaded: raw.downloaded ?? 0,
    deleted: raw.deleted ?? 0,
    conflicts: raw.conflicts ?? 0,
    errors: raw.errors ?? [],
    startedAt: new Date().toISOString(),
    completedAt: raw.timestamp ?? new Date().toISOString(),
  }
}
