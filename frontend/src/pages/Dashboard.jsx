import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { Alert, Card, Empty, PageHeader, Spinner, Tag, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'

function Stat({ label, value, to }) {
  return (
    <Link to={to} className="card block p-5 transition hover:-translate-y-0.5">
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="mt-1 text-4xl font-semibold">{value}</p>
    </Link>
  )
}

export default function Dashboard() {
  const { data, error, loading } = useAsync(() => api('/api/dashboard'))
  if (loading) return <Spinner />
  if (error) return <Alert>{error}</Alert>
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <>
      <PageHeader eyebrow={greeting + ','} title={data.owner}
        subtitle={data.death_triggered_at ? 'Your vault is sealed. Your legacy policy is now in effect.' : 'What would you like to remember today?'}
        actions={!data.death_triggered_at && <Link to="/write" className="btn-primary"><NavIcon name="write" size={16} />New entry</Link>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Diary entries" value={data.entry_count} to="/entries" />
        <Stat label="Letters" value={data.letter_count} to="/entries?kind=letter" />
        <Stat label="Beneficiaries" value={data.beneficiary_count} to="/beneficiaries" />
        <Stat label="Needs review" value={data.pending_reviews} to={data.pending_reviews ? '/entries?review=1' : '/entries'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Recent pages</h2>
            <Link to="/entries" className="text-sm text-bark-500 hover:underline">All entries →</Link>
          </div>
          {data.recent.length === 0 ? (
            <Empty title="Your diary is empty" action={<Link to="/write" className="btn-primary">Write your first entry</Link>}>
              Start with something small: what you ate, who you saw, what you hope for.
            </Empty>
          ) : (
            <ul className="divide-y divide-cream-300">
              {data.recent.map((e) => (
                <li key={e.id}>
                  <Link to={`/entries/${e.id}`} className="block py-3 hover:bg-cream-100/60">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-lg font-semibold">{e.title || 'Untitled'}</span>
                      <span className="shrink-0 text-xs text-ink-400">{fmtDate(e.entry_date)}</span>
                    </div>
                    <p className="line-clamp-1 text-sm text-ink-400">{e.snippet}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="text-2xl font-semibold">Your vault</h2>
            <p className={`mt-2 flex items-center gap-2 font-medium ${data.integrity.ok ? 'text-sage-600' : 'text-rose-600'}`}>
              <NavIcon name={data.integrity.ok ? 'access' : 'close'} size={18} />
              {data.integrity.ok ? 'Sealed and verified' : 'Something was changed'}
            </p>
            <p className="mt-1 text-sm text-ink-400">
              {data.integrity.ok ? 'Every entry is exactly as you saved it.' : 'Some records no longer match what was saved. Check the details.'}
            </p>
            <Link to="/vault" className="mt-3 inline-block text-sm text-bark-500 hover:underline">Details →</Link>
          </Card>
          <Card>
            <h2 className="text-2xl font-semibold">Themes</h2>
            {data.topics.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.topics.map(([t, n]) => <Link key={t} to={`/entries?topic=${t}`}><Tag>{t} · {n}</Tag></Link>)}
              </div>
            ) : <p className="mt-2 text-sm text-ink-400">Themes appear as you write.</p>}
            {data.pending_reviews > 0 && (
              <Link to="/entries?review=1" className="mt-4 block text-sm text-bark-600 hover:underline">{data.pending_reviews} entr{data.pending_reviews === 1 ? 'y has' : 'ies have'} suggestions waiting for review →</Link>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
