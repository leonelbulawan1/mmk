import { Link } from 'react-router-dom'
import NavIcon from './NavIcon'

// One Diary entries page with three views: the list, writing an entry, writing a letter.
// Drawn as a segmented control: equal segments, the current one raised.
const TABS = [
  ['list', 'All entries', '/entries', 'entries'],
  ['text', 'New entry', '/entries/new', 'write'],
  ['letter', 'New letter', '/entries/new?kind=letter', 'letters'],
]

export default function EntriesTabs({ active, canWrite = true }) {
  const tabs = canWrite ? TABS : TABS.slice(0, 1)
  if (tabs.length < 2) return null
  return (
    <nav aria-label="Diary entries" className="mb-6 grid grid-cols-3 gap-1 rounded-2xl border border-cream-300 bg-cream-100 p-1">
      {tabs.map(([key, label, to, icon]) => {
        const on = key === active
        return (
          <Link key={key} to={to} aria-current={on ? 'page' : undefined}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500
              ${on ? 'bg-white text-ink-700 shadow-paper ring-1 ring-cream-300' : 'text-ink-500 hover:bg-cream-200/70 hover:text-ink-700'}`}>
            <span className={`hidden sm:inline-flex ${on ? 'text-ink-700' : 'text-ink-400'}`}><NavIcon name={icon} size={17} /></span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
