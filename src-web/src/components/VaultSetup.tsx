import { useState } from 'react'
import * as api from '../ipc/tauri'
import { useI18n } from '../i18n'

interface VaultSetupProps {
  onInit: (path: string) => Promise<void>
}

export default function VaultSetup({ onInit }: VaultSetupProps) {
  const { t } = useI18n()
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Vault Folder',
      })
      if (selected) {
        setPath(selected as string)
      }
    } catch (e) {
      console.error('Dialog failed:', e)
    }
  }

  const handleSubmit = async () => {
    if (!path.trim()) {
      setError(t('vault.pleaseSelect'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      await onInit(path.trim())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-base">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">📓</div>
          <h1 className="text-2xl font-bold text-text-primary">MiniObsidian</h1>
          <p className="text-text-secondary mt-2">
            Select a folder to store your notes
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">
              Vault Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={t('vault.pathPlaceholder')}
                className="flex-1 px-3 py-2 bg-muted border border-border-hover rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleBrowse}
                className="px-4 py-2 bg-muted border border-border-hover rounded-lg text-text-primary hover:bg-hover transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-2.5 bg-accent text-text-inverse font-medium rounded-lg hover:bg-lavender transition-colors disabled:opacity-50"
          >
            {loading ? 'Initializing...' : 'Open Vault'}
          </button>
        </div>
      </div>
    </div>
  )
}
