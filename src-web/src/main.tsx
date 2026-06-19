import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { initErrorLogger } from './utils/errorLogger'
import { ErrorBoundary } from './components/ErrorBoundary'

// Initialize global error logger before app renders
initErrorLogger()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
