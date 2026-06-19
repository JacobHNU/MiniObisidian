import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isOpen) {
      confirmBtnRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onConfirm, onCancel])

  if (!isOpen) return null

  const confirmBtnClass = variant === 'danger'
    ? 'bg-[#f38ba8] hover:bg-[#e06080] text-[#1e1e2e]'
    : 'bg-[#f9e2af] hover:bg-[#e6c97a] text-[#1e1e2e]'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-[#1e1e2e] rounded-lg shadow-2xl w-[400px] border border-[#45475a] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-2 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
            variant === 'danger' ? 'bg-[#f38ba8]/20' : 'bg-[#f9e2af]/20'
          }`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={variant === 'danger' ? '#f38ba8' : '#f9e2af'} strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[#cdd6f4]">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-1">
          <p className="text-sm text-[#a6adc8] leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#181825] flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm text-[#a6adc8] bg-[#313244] rounded-md hover:bg-[#45475a] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${confirmBtnClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
