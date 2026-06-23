import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import IconRenderer from '../components/Icons/IconRenderer'
import TagBadge from '../components/Tags/TagBadge'

// ── IconRenderer Tests ─────────────────────────────────────────────
describe('IconRenderer', () => {
  it('renders default icon when icon is null', () => {
    const { container } = render(<IconRenderer icon={null} />)
    // Should render a lucide FileText icon (svg element)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders emoji when icon is an emoji string', () => {
    render(<IconRenderer icon="📁" />)
    expect(screen.getByText('📁')).toBeTruthy()
  })

  it('renders lucide icon when icon is a valid lucide name', () => {
    const { container } = render(<IconRenderer icon="Star" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders fallback when icon is null and fallback is provided', () => {
    render(<IconRenderer icon={null} fallback={<span>custom-fallback</span>} />)
    expect(screen.getByText('custom-fallback')).toBeTruthy()
  })

  it('renders text for unknown icon strings', () => {
    render(<IconRenderer icon="unknown-icon" />)
    expect(screen.getByText('unknown-icon')).toBeTruthy()
  })

  it('renders lucide icon with case-insensitive lookup', () => {
    const { container } = render(<IconRenderer icon="folderOpen" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

// ── TagBadge Tests ─────────────────────────────────────────────────
describe('TagBadge', () => {
  it('renders tag name', () => {
    render(<TagBadge name="rust" />)
    expect(screen.getByText('rust')).toBeTruthy()
  })

  it('renders with custom color', () => {
    const { container } = render(<TagBadge name="tag1" color="#f38ba8" />)
    const badge = container.querySelector('span')
    expect(badge).toBeTruthy()
    expect(badge!.style.backgroundColor).toContain('f38ba8')
  })

  it('renders remove button when onRemove is provided', () => {
    const onRemove = () => {}
    const { container } = render(<TagBadge name="tag1" onRemove={onRemove} />)
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('does not render remove button when onRemove is not provided', () => {
    const { container } = render(<TagBadge name="tag1" />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('calls onClick when clicked', () => {
    let clicked = false
    render(<TagBadge name="tag1" onClick={() => { clicked = true }} />)
    screen.getByText('tag1').closest('span')!.click()
    expect(clicked).toBe(true)
  })

  it('applies sm size classes by default', () => {
    const { container } = render(<TagBadge name="tag1" size="sm" />)
    const badge = container.querySelector('span')
    expect(badge!.className).toContain('text-xs')
  })

  it('applies md size classes', () => {
    const { container } = render(<TagBadge name="tag1" size="md" />)
    const badge = container.querySelector('span')
    expect(badge!.className).toContain('text-sm')
  })
})
