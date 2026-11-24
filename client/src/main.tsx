import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ios-theme.css'
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

// React 19 hoists <style href precedence> to the front of <head>. The Liquid
// Glass components do the same for their GLASS_CSS, which declares
// `@layer components`; if that is the first layer statement the browser sees,
// it puts `components` before `base` and the reset wipes component spacing.
// Render this hoisted pin first so the layer order is fixed before any glass
// component mounts. (index.html carries the same statement for non-React
// shells; React's hoisted copy is the one that lands first.)
const CASCADE_LAYER_ORDER = '@layer properties, theme, base, components, utilities;'

// eslint-disable-next-line react-refresh/only-export-components -- entry module, no Fast Refresh boundary
function CascadeLayers() {
  return <style href="la-pluma-cascade-layers" precedence="default">{CASCADE_LAYER_ORDER}</style>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CascadeLayers />
    <App />
  </StrictMode>,
)
