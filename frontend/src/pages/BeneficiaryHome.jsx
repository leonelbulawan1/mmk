import { Link } from 'react-router-dom'
import { api } from '../api'
import { ExecutorPanel } from '../components/Executor'
import { Alert, Card, PageHeader, Spinner, useAsync } from '../components/ui'

export default function BeneficiaryHome() {
  const o = useAsync(() => api('/api/beneficiary/overview'))
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
        <Card className="text-center">
          <p className="mx-auto max-w-xl text-ink-500">
            Nothing is shared while {first} is alive. When the time comes, the entries and letters {first} chose for you
            will open here, and you will receive an email.
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
          <Link to="/assistant" className="btn-primary mt-6">✦ Ask about {first}</Link>
        </Card>
        <Card>
          <p className="text-5xl font-semibold">{d.released_letters}</p>
          <p className="text-sm text-ink-400">letter{d.released_letters === 1 ? '' : 's'} addressed to you, opened</p>
          <Link to="/letters" className="btn-secondary mt-6">✉ Read letters</Link>
        </Card>
      </div>
    </>
  )
}
