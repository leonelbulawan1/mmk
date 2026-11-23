import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import NavIcon from './NavIcon'

// "+ New" button with a small menu: Diary entry or Letter.
// The composer opens in a floating window over the current page (see App.jsx).
export default function NewMenu({ label = 'New', icon = 'plus' }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    ref.current?.querySelector('[role=menuitem]')?.focus()
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const item = 'flex items-start gap-3 px-4 py-3 hover:bg-cream-200 focus:bg-cream-200 focus:outline-none'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="btn-primary">
        {icon === 'write' ? <NavIcon name="write" size={16} /> : <span aria-hidden className="text-lg leading-none">+</span>}{label}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-cream-300 bg-cream-50 py-1 shadow-paper">
          <Link role="menuitem" to="/entries/new" state={{ background: location }} onClick={() => setOpen(false)} className={item}>
            <span className="mt-0.5 text-ink-500"><NavIcon name="write" size={18} /></span>
            <span><span className="block text-sm font-medium text-ink-700">Diary</span><span className="block text-xs text-ink-400">Only you can read it</span></span>
          </Link>
          <Link role="menuitem" to="/entries/new?kind=letter" state={{ background: location }} onClick={() => setOpen(false)} className={item}>
            <span className="mt-0.5 text-ink-500"><NavIcon name="letters" size={18} /></span>
            <span><span className="block text-sm font-medium text-ink-700">Letter</span><span className="block text-xs text-ink-400">For a beneficiary you choose</span></span>
          </Link>
        </div>
      )}
    </div>
  )
}
