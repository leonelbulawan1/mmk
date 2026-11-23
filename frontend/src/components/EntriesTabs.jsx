import { Link } from 'react-router-dom'
import NavIcon from './NavIcon'

// One Diary entries page with three tabs: the list, writing an entry, writing a letter.
const TABS = [
  ['list', 'All entries', '/entries', 'entries'],
  ['text', 'New entry', '/entries/new', 'write'],
  ['letter', 'New letter', '/entries/new?kind=letter', 'letters'],
]

export default function EntriesTabs({ active, canWrite = true }) {
  const tabs = canWrite ? TABS : TABS.slice(0, 1)
  if (tabs.length < 2) return null
  return (
    <nav aria-label="Diary entries" className={`mb-6 grid border-b border-cream-300 ${tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
      {tabs.map(([key, label, to, icon]) => {
        const on = key === active
        return (
          <Link key={key} to={to} aria-current={on ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-[44px] items-center justify-center gap-2 border-b-2 px-2 text-sm font-medium ${on ? 'border-ink-700 text-ink-700' : 'border-transparent text-ink-400 hover:border-cream-300 hover:text-ink-700'}`}>
            <span className="hidden sm:inline-flex"><NavIcon name={icon} size={16} /></span>{label}
          </Link>
        )
      })}
    </nav>
  )
}
