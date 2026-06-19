/**
 * Global error logger - captures all runtime errors and reports to backend
 */

import { reportError } from '../ipc/tauri'

// Prevent duplicate reports within a short time window
const recentErrors = new Map<string, number>()
const DEDUP_WINDOW_MS = 5000

function shouldReport(message: string): boolean {
  const now = Date.now()
  const lastReport = recentErrors.get(message)
  if (lastReport && now - lastReport < DEDUP_WINDOW_MS) {
    return false
  }
  recentErrors.set(message, now)
  // Clean up old entries
  if (recentErrors.size > 100) {
    for (const [key, time] of recentErrors) {
      if (now - time > DEDUP_WINDOW_MS) recentErrors.delete(key)
    }
  }
  return true
}

function safeReport(
  errorType: string,
  message: string,
  stack?: string,
  context?: string,
  source?: string
) {
  if (!shouldReport(message)) return
  reportError(errorType, message, stack, context, source).catch(() => {
    // Silently ignore reporting failures to avoid infinite loops
  })
}

/**
 * Initialize global error handlers
 * Call this once at app startup
 */
export function initErrorLogger() {
  // 1. Window error handler - catches uncaught JS errors
  window.addEventListener('error', (event: ErrorEvent) => {
    safeReport(
      'UncaughtError',
      event.message || 'Unknown error',
      event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      JSON.stringify({
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        type: event.type,
      }),
      'window.onerror'
    )
  })

  // 2. Unhandled promise rejection handler
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined
    safeReport(
      'UnhandledRejection',
      message,
      stack,
      JSON.stringify({ type: 'unhandledrejection' }),
      'unhandledrejection'
    )
  })

  // 3. Console error interceptor
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => {
    const message = args.map(a => {
      if (a instanceof Error) return a.message
      if (typeof a === 'object') {
        try { return JSON.stringify(a) } catch { return String(a) }
      }
      return String(a)
    }).join(' ')

    // Don't report our own error reporting calls
    if (!message.includes('report_error') && !message.includes('reportError')) {
      const firstError = args.find(a => a instanceof Error) as Error | undefined
      safeReport(
        'ConsoleError',
        message,
        firstError?.stack,
        JSON.stringify({ argsCount: args.length }),
        'console.error'
      )
    }

    originalConsoleError.apply(console, args)
  }

  // 4. Resource loading error handler (images, scripts, etc.)
  window.addEventListener('error', (event: Event) => {
    const target = event.target as HTMLElement | null
    if (target && target !== (window as unknown as HTMLElement)) {
      const tagName = target.tagName?.toLowerCase() || 'unknown'
      const src = (target as HTMLImageElement).src || (target as HTMLScriptElement).src || ''
      safeReport(
        'ResourceLoadError',
        `Failed to load ${tagName}: ${src}`,
        undefined,
        JSON.stringify({ tagName, src, type: 'resource' }),
        'resource.onerror'
      )
    }
  }, true) // Use capture phase for resource errors

  console.log('[ErrorLogger] Global error handlers initialized')
}

/**
 * Log a custom error with context
 */
export function logError(
  errorType: string,
  message: string,
  error?: Error,
  context?: Record<string, unknown>
) {
  safeReport(
    errorType,
    message,
    error?.stack,
    context ? JSON.stringify(context) : undefined,
    'manual'
  )
}

/**
 * Wrap an async function with error logging
 */
export function withErrorLogging<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  name: string
): T {
  return ((...args: unknown[]) => {
    return fn(...args).catch((error: Error) => {
      safeReport(
        'AsyncFunctionError',
        `${name}: ${error.message}`,
        error.stack,
        JSON.stringify({ functionName: name, args: args.length }),
        'withErrorLogging'
      )
      throw error // Re-throw to not swallow the error
    })
  }) as T
}
