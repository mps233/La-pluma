import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles'
import App from '@/app/App'
import { AppToaster } from '@/shared/components'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <AppToaster />
    </ThemeProvider>
  </StrictMode>,
)
