import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { initErrorLogger } from './utils/errorLogger'
import { ErrorBoundary } from './components/ErrorBoundary'
import { I18nProvider } from './i18n'

// Initialize global error logger before app renders
initErrorLogger()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
)
