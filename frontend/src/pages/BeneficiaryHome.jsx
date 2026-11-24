import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { DisputePanel, ExecutorPanel } from '../components/Executor'
import { Alert, Card, Empty, PageHeader, Spinner, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'

export default function BeneficiaryHome() {
  const o = useAsync(() => api('/api/beneficiary/overview'))
  const letters = useAsync(() => api('/api/letters'))
  if (o.loading) return <Spinner label="Loading" />
  if (o.error) return <Alert>{o.error}</Alert>
  const d = o.data
  const first = d.owner.split(' ')[0]

  if (!d.death_triggered) {
    // The diary opens only after the owner's passing.
    return (
      <>
        <PageHeader title={`${d.owner}'s diary`} />
        {letters.data?.length > 0 && (
          <div className="mb-6 space-y-6">
            <h2 className="text-lg font-semibold">Letters from {first}</h2>
            {letters.data.map((l) => (
              <article key={l.entry_id} className="card p-6 sm:p-10 fade-in">
                <p className="text-sm font-medium text-bark-500">{fmtDate(l.date)}</p>
                <h3 className="mt-1 text-xl font-semibold">{l.title || 'A letter'}</h3>
                <p className="paper-lines mt-4 whitespace-pre-wrap text-lg text-ink-600">{l.text}</p>
              </article>
            ))}
          </div>
        )}
        {!letters.loading && !letters.data?.length && <Empty title="No letters yet" />}
        <ExecutorPanel />
        <DisputePanel />
      </>
    )
  }

  return (
    <>
      <PageHeader title={`${d.owner}'s diary`} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <p className="text-sm font-medium text-ink-500">Shared with you</p>
          <p className="mt-2 text-5xl font-semibold">{d.shared_entries}</p>
          <p className="text-sm text-ink-400">entr{d.shared_entries === 1 ? 'y' : 'ies'}</p>
          <Link to="/assistant" className="btn-primary mt-6"><NavIcon name="assistant" size={16} />Ask about {first}</Link>
        </Card>
        <Card>
          <p className="text-sm font-medium text-ink-500">Letters for you</p>
          <p className="mt-2 text-5xl font-semibold">{d.released_letters}</p>
          <p className="text-sm text-ink-400">letter{d.released_letters === 1 ? '' : 's'}</p>
          <Link to="/letters" className="btn-secondary mt-6">Read letters</Link>
        </Card>
      </div>
    </>
  )
}
