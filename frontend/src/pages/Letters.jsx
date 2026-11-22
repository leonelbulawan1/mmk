import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, PageHeader, Spinner, useAsync } from '../components/ui'

export default function Letters() {
  const { user } = useAuth()
  const letters = useAsync(() => api('/api/letters'))
  return (
    <>
      <PageHeader eyebrow="for you" title="Letters" subtitle={`Letters ${user.owner?.display_name || ''} wrote to you appear here once they are released.`} />
      {letters.loading ? <Spinner /> : letters.error ? <Alert>{letters.error}</Alert> : !letters.data.length ? (
        <Empty title="No letters yet">{user.owner?.death_triggered
          ? 'Some letters open on a particular day; they will appear here when they do.'
          : `Letters open only after ${user.owner?.display_name || 'the owner'}'s passing.`}</Empty>
      ) : (
        <div className="space-y-8">
          {letters.data.map((l) => (
            <article key={l.entry_id} className="card mx-auto max-w-3xl p-8 sm:p-12 fade-in">
              <p className="text-sm font-medium text-bark-500">{fmtDate(l.date)}</p>
              <h2 className="mt-1 text-3xl font-semibold">{l.title}</h2>
              <p className="paper-lines mt-6 whitespace-pre-wrap text-lg text-ink-600">{l.text}</p>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
