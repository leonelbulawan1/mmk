import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth'
import './index.css'

// VITE_WEB_RUNTIME=1 builds the self-contained browser edition (backend runs in the page).
const WEB = import.meta.env.VITE_WEB_RUNTIME === '1'
const root = createRoot(document.getElementById('root'))

function RememberPath() {
  const loc = useLocation()
  useEffect(() => { try { sessionStorage.setItem('alaala.path', loc.pathname + loc.search) } catch { /* ignore */ } }, [loc])
  return null
}

function Shell({ children }) {
  if (!WEB) return <BrowserRouter>{children}</BrowserRouter>
  let start = '/'
  try { start = sessionStorage.getItem('alaala.path') || '/' } catch { /* ignore */ }
  return <MemoryRouter initialEntries={[start]}><RememberPath />{children}</MemoryRouter>
}

function Loading({ step, pct, error }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <img src="./favicon.svg" alt="" className="h-16 w-16" />
      <h1 className="mt-4 text-4xl font-extrabold tracking-[0.06em]">MMK</h1>
      {error ? (
        <p className="mt-6 max-w-md text-sm text-rose-600">The demo could not start: {error}</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-500">{step}…</p>
          <div className="mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-cream-300">
            <div className="h-full bg-gold-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-6 max-w-md text-xs text-ink-400">
            The full system runs inside this page: the Python backend in WebAssembly, the access rules in SWI-Prolog,
            and a private SQLite database in your browser. First load takes a little while.
          </p>
        </>
      )}
    </div>
  )
}

function DemoBar() {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed bottom-3 right-3 z-50 text-xs">
      {open && (
        <div className="card mb-2 w-72 p-4 text-left fade-in">
          <p className="font-medium text-ink-700">Browser demo</p>
          <p className="mt-1 text-ink-400">Everything runs in this tab and is saved only in this browser. All people are fictional.</p>
          <p className="mt-2 text-ink-500">Password for every account: <code>alaala2026</code></p>
          <ul className="mt-1 space-y-0.5 text-ink-500">
            <li>Owner: elena@example.com</li>
            <li>Beneficiaries: maria@ · jose@ · lina@example.com</li>
          </ul>
          <button className="btn-secondary mt-3 w-full py-1.5 text-xs" onClick={async () => { const m = await import('./webRuntime'); m.resetDemo() }}>
            Reset demo data
          </button>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="rounded-full bg-ink-700 px-3 py-1.5 text-cream-50 shadow-paper">
        {open ? 'Close' : 'Demo · accounts'}
      </button>
    </div>
  )
}

const app = (
  <StrictMode>
    <Shell>
      <AuthProvider>
        <App />
        {WEB && <DemoBar />}
      </AuthProvider>
    </Shell>
  </StrictMode>
)

if (WEB) {
  root.render(<Loading step="Preparing" pct={3} />)
  import('./webRuntime')
    .then((m) => m.boot((step, pct) => root.render(<Loading step={step} pct={pct} />)))
    .then(() => root.render(app))
    .catch((e) => root.render(<Loading error={e?.message || String(e)} />))
} else {
  root.render(app)
}
