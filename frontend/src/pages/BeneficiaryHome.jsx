import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { ExecutorPanel } from '../components/Executor'
import { Alert, Card, PageHeader, Spinner, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'

export default function BeneficiaryHome() {
  const o = useAsync(() => api('/api/beneficiary/overview'))
  const letters = useAsync(() => api('/api/letters'))
  if (o.loading) return <Spinner />
  if (o.error) return <Alert>{o.error}</Alert>
  const d = o.data
  const first = d.owner.split(' ')[0]

  if (!d.death_triggered) {
    // The diary opens only after the owner's passing.
    return (
      <>
        <PageHeader eyebrow="welcome" title={`${d.owner}'s diary`}
          subtitle={`${d.owner} named you as someone who may remember them through their diary.`} />
        {letters.data?.length > 0 && (
          <div className="mb-6 space-y-6">
            <h2 className="text-2xl font-semibold">Letters from {first}</h2>
            {letters.data.map((l) => (
              <article key={l.entry_id} className="card p-6 sm:p-10 fade-in">
                <p className="text-sm font-medium text-bark-500">{fmtDate(l.date)}</p>
                <h3 className="mt-1 text-2xl font-semibold">{l.title || 'A letter'}</h3>
                <p className="paper-lines mt-4 whitespace-pre-wrap text-lg text-ink-600">{l.text}</p>
              </article>
            ))}
          </div>
        )}
        <Card className="text-center">
          <p className="mx-auto max-w-xl text-ink-500">
            {letters.data?.length
              ? <>{first}'s diary entries stay private while {first} is alive. When {first} sends you another letter, you will get an email and it will appear here.</>
              : <>Nothing has been sent to you yet. When {first} sends you a letter, you will get an email and it will appear here. {first}'s diary entries stay private while {first} is alive.</>}
          </p>
        </Card>
        <ExecutorPanel />
      </>
    )
  }

  return (
    <>
      <PageHeader eyebrow="in loving memory" title={`${d.owner}'s diary`}
        subtitle={`${d.owner} chose to share some of their life with you. What you can see follows their wishes, and some of it may open on a later date.`} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <p className="text-5xl font-semibold">{d.shared_entries}</p>
          <p className="text-sm text-ink-400">entr{d.shared_entries === 1 ? 'y' : 'ies'} shared with you</p>
          <Link to="/assistant" className="btn-primary mt-6"><NavIcon name="assistant" size={16} />Ask about {first}</Link>
        </Card>
        <Card>
          <p className="text-5xl font-semibold">{d.released_letters}</p>
          <p className="text-sm text-ink-400">letter{d.released_letters === 1 ? '' : 's'} addressed to you, opened</p>
          <Link to="/letters" className="btn-secondary mt-6">Read letters</Link>
        </Card>
      </div>
    </>
  )
}
