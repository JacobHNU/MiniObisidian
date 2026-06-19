import { useState } from 'react'

interface ExportPDFDialogProps {
  isOpen: boolean
  noteTitle: string
  noteContent: string
  onExport: (options: ExportOptions) => void
  onClose: () => void
}

export interface ExportOptions {
  pageSize: 'A4' | 'Letter' | 'Legal'
  orientation: 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  includeHeader: boolean
  headerText: string
  includeFooter: boolean
  footerText: string
  includeWatermark: boolean
  watermarkText: string
  passwordProtect: boolean
  password: string
}

const defaultOptions: ExportOptions = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  includeHeader: true,
  headerText: '{title} - {date}',
  includeFooter: true,
  footerText: '第 {page} 页',
  includeWatermark: false,
  watermarkText: '',
  passwordProtect: false,
  password: ''
}

export default function ExportPDFDialog({
  isOpen,
  noteTitle,
  onExport,
  onClose
}: ExportPDFDialogProps) {
  const [options, setOptions] = useState<ExportOptions>({
    ...defaultOptions,
    headerText: `${noteTitle} - {date}`
  })

  if (!isOpen) return null

  const handleExport = () => {
    onExport(options)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1e1e2e] rounded-lg shadow-2xl w-[500px] border border-[#45475a] overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[#cdd6f4]">导出为PDF</h3>
          <button onClick={onClose} className="p-1 hover:bg-[#313244] rounded text-[#a6adc8]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-4">
          {/* Page settings */}
          <div>
            <h4 className="text-sm font-medium text-[#cdd6f4] mb-2">页面设置</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#6c7086]">页面大小</label>
                <select
                  value={options.pageSize}
                  onChange={(e) => setOptions({ ...options, pageSize: e.target.value as any })}
                  className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[#6c7086]">方向</label>
                <select
                  value={options.orientation}
                  onChange={(e) => setOptions({ ...options, orientation: e.target.value as any })}
                  className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
                >
                  <option value="portrait">纵向</option>
                  <option value="landscape">横向</option>
                </select>
              </div>
            </div>
          </div>

          {/* Margins */}
          <div>
            <h4 className="text-sm font-medium text-[#cdd6f4] mb-2">页边距 (mm)</h4>
            <div className="grid grid-cols-4 gap-2">
              {(['top', 'right', 'bottom', 'left'] as const).map(side => (
                <div key={side}>
                  <label className="text-xs text-[#6c7086]">
                    {side === 'top' ? '上' : side === 'right' ? '右' : side === 'bottom' ? '下' : '左'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={options.margins[side]}
                    onChange={(e) => setOptions({
                      ...options,
                      margins: { ...options.margins, [side]: parseInt(e.target.value) || 0 }
                    })}
                    className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={options.includeHeader}
                onChange={(e) => setOptions({ ...options, includeHeader: e.target.checked })}
                className="rounded"
              />
              <h4 className="text-sm font-medium text-[#cdd6f4]">页眉</h4>
            </div>
            {options.includeHeader && (
              <input
                type="text"
                value={options.headerText}
                onChange={(e) => setOptions({ ...options, headerText: e.target.value })}
                placeholder="使用 {title} {date} {author} 作为变量"
                className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
              />
            )}
          </div>

          {/* Footer */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={options.includeFooter}
                onChange={(e) => setOptions({ ...options, includeFooter: e.target.checked })}
                className="rounded"
              />
              <h4 className="text-sm font-medium text-[#cdd6f4]">页脚</h4>
            </div>
            {options.includeFooter && (
              <input
                type="text"
                value={options.footerText}
                onChange={(e) => setOptions({ ...options, footerText: e.target.value })}
                placeholder="使用 {page} {total} 作为变量"
                className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
              />
            )}
          </div>

          {/* Watermark */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={options.includeWatermark}
                onChange={(e) => setOptions({ ...options, includeWatermark: e.target.checked })}
                className="rounded"
              />
              <h4 className="text-sm font-medium text-[#cdd6f4]">水印</h4>
            </div>
            {options.includeWatermark && (
              <input
                type="text"
                value={options.watermarkText}
                onChange={(e) => setOptions({ ...options, watermarkText: e.target.value })}
                placeholder="水印文字"
                className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
              />
            )}
          </div>

          {/* Password protection */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={options.passwordProtect}
                onChange={(e) => setOptions({ ...options, passwordProtect: e.target.checked })}
                className="rounded"
              />
              <h4 className="text-sm font-medium text-[#cdd6f4]">密码保护</h4>
            </div>
            {options.passwordProtect && (
              <input
                type="password"
                value={options.password}
                onChange={(e) => setOptions({ ...options, password: e.target.value })}
                placeholder="设置PDF密码"
                className="w-full h-8 bg-[#313244] text-[#cdd6f4] text-sm rounded border border-[#45475a] px-2"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#181825] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-[#a6adc8] bg-[#313244] rounded-md hover:bg-[#45475a]"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-1.5 text-sm font-medium bg-[#89b4fa] text-[#1e1e2e] rounded-md hover:bg-[#74c7ec]"
          >
            导出
          </button>
        </div>
      </div>
    </div>
  )
}
