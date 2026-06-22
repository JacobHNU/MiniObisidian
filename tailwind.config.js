/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src-web/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Theme-aware colors (driven by CSS variables) ──────── */
        base:          'var(--bg-base)',
        surface:       'var(--bg-surface)',
        overlay:       'var(--bg-overlay)',
        muted:         'var(--bg-muted)',
        hover:         'var(--bg-hover)',
        subtle:        'var(--bg-subtle)',
        accent:        'var(--accent)',
        red:           'var(--red)',
        blue:          'var(--blue)',
        green:         'var(--green)',
        yellow:        'var(--yellow)',
        orange:        'var(--orange)',
        pink:          'var(--pink)',
        sky:           'var(--sky)',
        teal:          'var(--teal)',
        lavender:      'var(--lavender)',
        rosewater:     'var(--rosewater)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted':     'var(--text-muted)',
        'text-subtle':    'var(--text-subtle)',
        'text-inverse':   'var(--text-inverse)',
        'text-overlay':   'var(--text-overlay)',
        'text-surface':   'var(--text-surface)',
        'border-muted':   'var(--border-muted)',
        'border-hover':   'var(--border-hover)',
        'border-subtle':  'var(--border-subtle)',
        'border-base':    'var(--border-base)',

        /* ── Legacy / static colors ────────────────────────────── */
        vault: {
          50: '#f8f7f4', 100: '#edeae3', 200: '#dbd5c8',
          300: '#c4baa5', 400: '#ab9b7e', 500: '#978467',
          600: '#846f57', 700: '#6c5a49', 800: '#5a4b40', 900: '#4d4138',
        },
      },
    },
  },
  plugins: [],
}
