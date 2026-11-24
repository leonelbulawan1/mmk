import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import NavIcon from './NavIcon'

// "+ New" button with a small menu: Diary entry or Letter.
// The composer opens in a floating window over the current page (see App.jsx).
export default function NewMenu({ label = 'New', icon = 'plus' }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // Opened with the keyboard? Then move focus into the menu; with a mouse, nothing looks pre-selected.
  const byKeyboard = useRef(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    if (byKeyboard.current) ref.current?.querySelector('[role=menuitem]')?.focus()
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const item = 'flex items-center gap-3 px-4 py-1.5 hover:bg-cream-200 focus:outline-none focus-visible:bg-cream-200'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { byKeyboard.current = e.detail === 0; setOpen(!open) }} aria-haspopup="menu" aria-expanded={open}
        className="btn-primary">
        <NavIcon name={icon === 'write' ? 'write' : 'plus'} size={16} />{label}
        <NavIcon name="chevron-down" size={12} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-cream-300 bg-cream-50 py-2 shadow-pop">
          <Link role="menuitem" to="/entries/new" state={{ background: location }} onClick={() => setOpen(false)} className={item}>
            <span className="text-ink-500"><NavIcon name="write" size={18} /></span>
            <span className="text-sm font-medium text-ink-700">Diary</span>
          </Link>
          <Link role="menuitem" to="/entries/new?kind=letter" state={{ background: location }} onClick={() => setOpen(false)} className={item}>
            <span className="text-ink-500"><NavIcon name="letters" size={18} /></span>
            <span className="text-sm font-medium text-ink-700">Letter</span>
          </Link>
        </div>
      )}
    </div>
  )
}
