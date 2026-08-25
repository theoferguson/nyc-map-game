import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AdminPanel from './admin/AdminPanel.tsx'

// A plain route, not a hidden one. The admin token is the boundary -- nothing
// typed in the panel takes effect until the endpoint accepts a write -- so
// there is nothing to gain from making the URL a secret as well.
const admin = new URLSearchParams(window.location.search).has('admin')

// Tiles only, and only in production: in development the service worker would
// sit between Vite and the browser for no benefit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A browser that refuses it just pays for tiles every visit.
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {admin ? <AdminPanel /> : <App />}
  </StrictMode>,
)
