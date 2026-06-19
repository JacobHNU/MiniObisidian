import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'src-web',
  base: './',  // Relative paths for Tauri embedded assets
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',  // Required for top-level await (used by pdfjs-dist)
  },
  esbuild: {
    target: 'esnext',
  },
  server: {
    strictPort: true,
    port: 5173,
    host: true,  // Bind to all interfaces (fixes IPv4/IPv6 issues)
  },
  clearScreen: false,
})
