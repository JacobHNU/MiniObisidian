import IconRenderer from '../Icons/IconRenderer'

interface TagBadgeProps {
  name: string
  color?: string
  icon?: string | null
  onClick?: () => void
  onRemove?: () => void
  size?: 'sm' | 'md'
  className?: string
}

export default function TagBadge({ name, color = '#cba6f7', icon, onClick, onRemove, size = 'sm', className = '' }: TagBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-xs px-1.5 py-0.5 gap-1' : 'text-sm px-2 py-1 gap-1.5'
  const iconSize = size === 'sm' ? 12 : 14

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium transition-colors ${sizeClasses} ${
        onClick ? 'cursor-pointer hover:opacity-80' : ''
      } ${className}`}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
      onClick={onClick}
    >
      {icon && <IconRenderer icon={icon} size={iconSize} />}
      <span>{name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 hover:opacity-60 transition-opacity"
          style={{ color: 'inherit' }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}
