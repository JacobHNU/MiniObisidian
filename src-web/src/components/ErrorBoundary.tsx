import React, { Component, ErrorInfo, ReactNode } from 'react'
import { reportError } from '../ipc/tauri'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Report to backend logging system
    reportError(
      'ReactRenderError',
      error.message,
      error.stack,
      JSON.stringify({
        componentStack: errorInfo.componentStack,
        digest: errorInfo.digest,
      }),
      'ErrorBoundary'
    ).catch(() => {})

    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen p-8 bg-base text-text-primary" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <div className="max-w-[600px] text-center">
            <h2 className="text-red mb-4">
              页面渲染异常
            </h2>
            <p className="text-text-secondary mb-6">
              应用遇到了一个渲染错误，请尝试刷新页面。
            </p>
            <details className="mb-6 text-left bg-muted p-4 rounded-lg max-h-[200px] overflow-auto">
              <summary className="cursor-pointer text-blue">
                错误详情
              </summary>
              <pre className="mt-2 text-xs text-red whitespace-pre-wrap break-words">
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            </details>
            <div className="flex gap-4 justify-center">
              <button
                onClick={this.handleReset}
                className="px-6 py-3 bg-blue text-text-inverse border-none rounded-md cursor-pointer font-bold hover:bg-lavender transition-colors"
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-hover text-text-primary border border-border-subtle rounded-md cursor-pointer hover:bg-subtle transition-colors"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
