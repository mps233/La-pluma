import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ios-theme.css'
import './glasswork/glass.css'
import App from './App.tsx'

// Glasswork: Safari on iOS can leave a backdrop filter clipped to a
// superellipse undrawn on real devices, so WebKit keeps round glass corners.
if (typeof navigator !== 'undefined' && /Apple/i.test(navigator.vendor ?? '')) {
  document.documentElement.dataset.engine = 'webkit'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
