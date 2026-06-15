import { useState } from 'react'
import * as api from '../ipc/tauri'

interface VaultSetupProps {
  onInit: (path: string) => Promise<void>
}

export default function VaultSetup({ onInit }: VaultSetupProps) {
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
      setError('Please select a folder')
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
    <div className="flex items-center justify-center h-screen bg-[#1e1e2e]">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">📓</div>
          <h1 className="text-2xl font-bold text-[#cdd6f4]">MiniObsidian</h1>
          <p className="text-[#a6adc8] mt-2">
            Select a folder to store your notes
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[#a6adc8] mb-1.5">
              Vault Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/your/notes"
                className="flex-1 px-3 py-2 bg-[#313244] border border-[#45475a] rounded-lg text-[#cdd6f4] placeholder-[#6c7086] focus:outline-none focus:border-[#cba6f7]"
              />
              <button
                onClick={handleBrowse}
                className="px-4 py-2 bg-[#313244] border border-[#45475a] rounded-lg text-[#cdd6f4] hover:bg-[#45475a] transition-colors"
              >
                Browse
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#f38ba8]">{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-2.5 bg-[#cba6f7] text-[#1e1e2e] font-medium rounded-lg hover:bg-[#b4befe] transition-colors disabled:opacity-50"
          >
            {loading ? 'Initializing...' : 'Open Vault'}
          </button>
        </div>
      </div>
    </div>
  )
}
