import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PendingReportBanner } from './Executor'

const OWNER_NAV = [
  ['/dashboard', 'Dashboard', '◐'],
  ['/entries', 'Diary entries', '❧'],
  ['/write', 'Write', '✎'],
  ['/beneficiaries', 'Beneficiaries', '♡'],
  ['/policy', 'Legacy policy', '§'],
  ['/access', 'Access permissions', '⚿'],
  ['/assistant', 'AI assistant', '✦'],
  ['/vault', 'Vault integrity', '⛓'],
  ['/settings', 'Settings', '⚙'],
]
const BENEFICIARY_NAV = [
  ['/home', 'Home', '◐'],
  ['/assistant', 'Ask MMK', '✦'],
  ['/letters', 'Letters', '✉'],
  ['/settings', 'Settings', '⚙'],
]

export function Logo({ className = '' }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" />
      <span className="text-2xl font-extrabold tracking-[0.06em] text-ink-700">MMK</span>
    </Link>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const opened = user?.owner?.death_triggered
  const nav = user?.role === 'owner' ? OWNER_NAV
    : BENEFICIARY_NAV.filter(([to]) => opened || !['/assistant', '/letters'].includes(to))
  const sealed = user?.role === 'owner' ? user?.death_triggered_at : user?.owner?.death_triggered

  const links = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {nav.map(([to, label, icon]) => (
        <NavLink key={to} to={to} onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${isActive ? 'bg-ink-700 text-cream-50 shadow-paper' : 'text-ink-600 hover:bg-cream-200'}`}>
          <span aria-hidden className="w-5 text-center">{icon}</span>{label}
        </NavLink>
      ))}
    </nav>
  )

  const footer = (
    <div className="border-t border-cream-300 pt-4">
      <p className="truncate text-sm font-medium">{user?.display_name}</p>
      <p className="text-xs text-ink-400">{user?.role === 'owner' ? 'Diary owner' : `Beneficiary of ${user?.owner?.display_name || ''}`}</p>
      <button className="btn-ghost mt-2 -ml-2 px-2 py-1 text-xs" onClick={() => { logout(); navigate('/login') }}>Sign out</button>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-cream-300 bg-cream-50/80 p-5 backdrop-blur lg:flex">
        <div className="space-y-8"><Logo />{links}</div>
        {footer}
      </aside>

      <div className="flex items-center justify-between border-b border-cream-300 bg-cream-50/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button className="btn-ghost px-3" aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
      </div>
      {open && (
        <div className="space-y-6 border-b border-cream-300 bg-cream-50 p-4 lg:hidden fade-in">{links}{footer}</div>
      )}

      <main className="min-w-0 flex-1">
        <PendingReportBanner />
        {sealed && (
          <div className="border-b border-gold-500/30 bg-[#FBF0D9] px-6 py-2 text-center text-sm text-bark-600">
            {user?.role === 'owner'
              ? 'This vault is sealed. Entries and the legacy policy can no longer change.'
              : 'This diary has been sealed and its legacy releases are now active.'}
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12"><Outlet /></div>
      </main>
    </div>
  )
}
