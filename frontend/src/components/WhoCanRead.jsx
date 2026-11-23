import { Link } from 'react-router-dom'
import { api } from '../api'
import { reasonText } from './access'
import { Card, LevelBadge, Spinner, useAsync } from './ui'

/** For one entry: what each beneficiary will be able to read after the owner's passing (decided by Prolog). */
export default function WhoCanRead({ entryId, sealed, bare = false }) {
  const access = useAsync(() => api(`/api/entries/${entryId}/access`), [entryId])
  const people = access.data?.people || []
  const Wrap = bare ? 'div' : Card
  return (
    <Wrap className="space-y-3 text-sm">
      <div>
        <h2 className={bare ? 'text-sm font-semibold text-ink-700' : 'text-lg font-semibold'}>{sealed ? 'Who can read this' : 'Who can read this after you’re gone'}</h2>
        {!sealed && <p className="mt-1 text-xs text-ink-400">While you are alive, no one can read your diary.</p>}
      </div>
      {access.loading ? <Spinner label="Checking access" /> : access.error ? <p className="text-rose-600">{access.error}</p> : people.length === 0 ? (
        <p className="text-ink-400">No beneficiaries yet. <Link to="/beneficiaries" className="text-bark-500 hover:underline">Add one</Link></p>
      ) : (
        <ul className="divide-y divide-cream-300">
          {people.map((p) => (
            <li key={p.handle} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium text-ink-700">{p.display_name}{p.relationship && <span className="font-normal text-ink-400"> · {p.relationship}</span>}</p>
                <p className="text-xs text-ink-400">{reasonText(p)}</p>
              </div>
              <LevelBadge level={p.level} />
            </li>
          ))}
        </ul>
      )}
      {!sealed && people.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <Link to="/policy" className="text-bark-500 hover:underline">Change in Legacy policy →</Link>
          <Link to="/access" className="text-bark-500 hover:underline">All permissions →</Link>
        </div>
      )}
    </Wrap>
  )
}
