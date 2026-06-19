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
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '2rem',
          backgroundColor: '#1e1e2e',
          color: '#cdd6f4',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: '600px',
            textAlign: 'center',
          }}>
            <h2 style={{ color: '#f38ba8', marginBottom: '1rem' }}>
              页面渲染异常
            </h2>
            <p style={{ color: '#a6adc8', marginBottom: '1.5rem' }}>
              应用遇到了一个渲染错误，请尝试刷新页面。
            </p>
            <details style={{
              marginBottom: '1.5rem',
              textAlign: 'left',
              backgroundColor: '#313244',
              padding: '1rem',
              borderRadius: '8px',
              maxHeight: '200px',
              overflow: 'auto',
            }}>
              <summary style={{ cursor: 'pointer', color: '#89b4fa' }}>
                错误详情
              </summary>
              <pre style={{
                marginTop: '0.5rem',
                fontSize: '0.75rem',
                color: '#f38ba8',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
            </details>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={this.handleReset}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#89b4fa',
                  color: '#1e1e2e',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                重试
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#45475a',
                  color: '#cdd6f4',
                  border: '1px solid #585b70',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
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
