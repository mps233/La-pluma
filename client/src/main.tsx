import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'framework7/css/bundle'
import './index.css'
import './framework7-overrides.css'
import './framework7'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
