import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ios-theme.css'
import '@zakisheriff/liquid-glass/styles.css'
import App from './App.tsx'

// An installed PWA is a fixed-scale console. The CSS touch-action blocks
// pinch/double-tap zoom on Chromium; iOS Safari ignores viewport zoom rules,
// so stop its page-zoom gesture too. Regular browser tabs keep accessibility
// zoom, and component-level touch handling is unaffected.
const standalonePWA = window.matchMedia?.('(display-mode: standalone)')?.matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true
if (standalonePWA) {
  document.documentElement.classList.add('is-standalone-pwa')
  for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(eventName, (event) => event.preventDefault(), { passive: false })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
