import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import './styles.css'

if (import.meta.env.DEV && !window.masterCommander) {
  const { installPreviewApi } = await import('./previewApi')
  installPreviewApi()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
