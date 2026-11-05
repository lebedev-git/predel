import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/onest/400.css'
import '@fontsource/onest/500.css'
import '@fontsource/onest/600.css'
import '@fontsource/unbounded/500.css'
import '@fontsource/unbounded/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import Calc from './Calc.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('view') === 'calc' ? <Calc /> : <App />}
  </StrictMode>,
)
