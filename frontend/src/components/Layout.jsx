import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { PendingReportBanner } from './Executor'
import { ConfirmDialog, Spinner } from './ui'
import NavIcon from './NavIcon'

const OWNER_NAV = [
  ['/dashboard', 'Dashboard', 'dashboard'],
  ['/entries', 'Diary entries', 'entries'],
  ['/beneficiaries', 'Beneficiaries', 'people'],
  ['/policy', 'Legacy policy', 'policy'],
  ['/access', 'Access permissions', 'access'],
  ['/assistant', 'AI assistant', 'assistant'],
  ['/vault', 'Vault integrity', 'vault'],
  ['/settings', 'Settings', 'settings'],
]
const BENEFICIARY_NAV = [
  ['/home', 'Home', 'home'],
  ['/assistant', 'Ask MMK', 'assistant'],
  ['/letters', 'Letters', 'letters'],
  ['/settings', 'Settings', 'settings'],
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
  const [compact, setCompact] = useState(() => { try { return localStorage.getItem('mmk.sidebar') === 'compact' } catch { return false } })
  const [confirmOut, setConfirmOut] = useState(false)
  const toggleCompact = () => setCompact((c) => { try { localStorage.setItem('mmk.sidebar', c ? 'full' : 'compact') } catch { /* private mode */ } return !c })
  const signOut = () => { setConfirmOut(false); logout(); navigate('/login') }
  const opened = user?.owner?.death_triggered
  const nav = user?.role === 'owner' ? (user.is_reviewer ? [...OWNER_NAV, ['/review', 'Review reports', 'access']] : OWNER_NAV)
    : BENEFICIARY_NAV.filter(([to]) => opened || to !== '/assistant')
  const sealed = user?.role === 'owner' ? user?.death_triggered_at : user?.owner?.death_triggered

  const links = (small) => (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {nav.map(([to, label, icon]) => (
        <NavLink key={to} to={to} onClick={() => setOpen(false)} title={small ? label : undefined}
          className={({ isActive }) => `group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${small ? 'justify-center' : ''} ${isActive ? 'bg-ink-700 text-cream-50 shadow-paper' : 'text-ink-600 hover:bg-cream-200'}`}>
          {({ isActive }) => <>
            <NavIcon name={icon} />
            <span className={small ? 'sr-only' : ''}>{label}</span>
            {isActive && <span className="sr-only"> (current page)</span>}
            {small && <span aria-hidden="true" className="pointer-events-none absolute left-full z-40 ml-3 hidden whitespace-nowrap rounded-lg bg-ink-700 px-2.5 py-1 text-xs text-cream-50 shadow-paper group-hover:block group-focus-visible:block">{label}</span>}
          </>}
        </NavLink>
      ))}
    </nav>
  )

  const footer = (
    <div className="border-t border-cream-300 pt-4">
      <p className="truncate text-sm font-medium">{user?.display_name}</p>
      <p className="text-xs text-ink-400">{user?.role === 'owner' ? 'Diary owner' : `Beneficiary of ${user?.owner?.display_name || ''}`}</p>
      <button className="btn-ghost mt-2 -ml-2 px-2 py-1 text-xs" onClick={() => setConfirmOut(true)}><NavIcon name="signout" size={14} />Sign out</button>
    </div>
  )
  const compactFooter = (
    <div className="flex flex-col items-center gap-1 border-t border-cream-300 pt-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cream-200 text-sm font-semibold text-ink-600" title={user?.display_name}>{(user?.display_name || '?').slice(0, 1).toUpperCase()}</span>
      <button className="btn-ghost h-11 w-11 justify-center px-0" onClick={() => setConfirmOut(true)} aria-label="Sign out" title="Sign out"><NavIcon name="signout" /></button>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink-700 focus:px-4 focus:py-2 focus:text-cream-50">Skip to main content</a>
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col justify-between border-r border-cream-300 bg-cream-50/80 backdrop-blur transition-[width] lg:flex ${compact ? 'w-20 px-3 py-5' : 'w-64 p-5'}`}>
        <div className="space-y-8">
          <div className={`flex items-center ${compact ? 'flex-col gap-3' : 'justify-between'}`}>
            {compact
              ? <Link to="/" aria-label="MMK home"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-9 w-9" /></Link>
              : <Logo />}
            <button className="btn-ghost h-9 w-9 justify-center px-0 text-ink-400" onClick={toggleCompact}
              aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'} title={compact ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={compact}>
              <NavIcon name={compact ? 'expand' : 'collapse'} />
            </button>
          </div>
          {links(compact)}
        </div>
        {compact ? compactFooter : footer}
      </aside>

      <div className="flex items-center justify-between border-b border-cream-300 bg-cream-50/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button className="btn-ghost px-3" aria-expanded={open} aria-label={open ? 'Close menu' : 'Menu'} onClick={() => setOpen((o) => !o)}><NavIcon name={open ? 'close' : 'menu'} size={22} /></button>
      </div>
      {open && (
        <div className="space-y-6 border-b border-cream-300 bg-cream-50 p-4 lg:hidden fade-in">{links(false)}{footer}</div>
      )}

      <ConfirmDialog open={confirmOut} title="Sign out?" confirmLabel="Sign out" onConfirm={signOut} onCancel={() => setConfirmOut(false)}>
        You will need your email and password to sign in again. Unsaved drafts on this device are removed when you sign out.
      </ConfirmDialog>
      <main id="main" className="min-w-0 flex-1">
        <PendingReportBanner />
        {sealed && (
          <div className="border-b border-gold-500/30 bg-[#FBF0D9] px-6 py-2 text-center text-sm text-bark-600">
            {user?.role === 'owner'
              ? 'This vault is sealed. Entries and the legacy policy can no longer change.'
              : 'This diary has been sealed and its legacy releases are now active.'}
          </div>
        )}
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:py-12"><Suspense fallback={<Spinner />}><Outlet /></Suspense></div>
      </main>
    </div>
  )
}
