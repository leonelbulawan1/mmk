import { Link, useLocation } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, PageHeader, Section, Spinner, Tag, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'
import NewMenu from '../components/NewMenu'

function Stat({ label, value, to, icon, note, highlight }) {
  return (
    <Link to={to} className={`card group flex items-start justify-between gap-3 p-5 transition hover:-translate-y-0.5 ${highlight ? 'ring-1 ring-gold-500/40' : ''}`}>
      <div>
        <p className="text-sm font-medium text-ink-500">{label}</p>
        <p className="mt-2 text-4xl font-semibold leading-none text-ink-700">{value}</p>
        {note && <p className={`mt-2 text-xs ${highlight ? 'text-bark-600' : 'text-ink-400'}`}>{note}</p>}
      </div>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cream-200 text-bark-500 transition group-hover:bg-ink-700 group-hover:text-cream-50">
        <NavIcon name={icon} size={20} />
      </span>
    </Link>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const location = useLocation()
  const { data, error, loading } = useAsync(() => api('/api/dashboard'))
  const draftList = drafts.list(user.id)
  if (loading) return <Spinner label="Loading your dashboard" />
  if (error) return <Alert>{error}</Alert>
  const sealed = !!data.death_triggered_at
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const draft = draftList[0]

  return (
    <>
      <PageHeader eyebrow={`${greeting},`} title={data.owner}
        subtitle={sealed ? 'Your vault is sealed. Your legacy policy is now in effect.' : 'What would you like to remember today?'}
        actions={!sealed && <NewMenu label="Write" icon="write" />} />

      {draft && !sealed && (
        <div className="card mb-6 flex flex-wrap items-center gap-4 px-5 py-4 fade-in">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-cream-300 text-ink-400">
            <NavIcon name={draft.form.kind === 'letter' ? 'letters' : 'write'} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{draft.form.title?.trim() || draft.form.text?.trim().slice(0, 80) || 'Untitled'}</p>
            <p className="text-xs text-ink-400">
              Unfinished {draft.form.kind === 'letter' ? 'letter' : 'entry'}
              {draft.saved_at && ` · saved ${new Date(draft.saved_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
              {draftList.length > 1 && ` · ${draftList.length - 1} more in Drafts`}
            </p>
          </div>
          <Link to={`/entries/new?draft=${draft.id}${draft.form.kind === 'letter' ? '&kind=letter' : ''}`} state={{ background: location }} className="btn-secondary">Continue writing</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Diary entries" value={data.entry_count} to="/entries?kind=text" icon="entries" note="Private to you" />
        <Stat label="Letters" value={data.letter_count} to="/entries?kind=letter" icon="letters" note="For your beneficiaries" />
        <Stat label="Beneficiaries" value={data.beneficiary_count} to="/beneficiaries" icon="people" note={`Policy v${data.policy_version} · ${data.policy_rules} rules`} />
        <Stat label="Needs review" value={data.pending_reviews} to={data.pending_reviews ? '/entries?review=1' : '/entries'} icon="edit"
          note={data.pending_reviews ? 'Suggestions waiting' : 'All caught up'} highlight={data.pending_reviews > 0} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <Section className="min-w-0 lg:col-span-2" title="Recent pages" bodyClassName="p-0"
          actions={<Link to="/entries" className="text-sm font-medium text-bark-500 hover:underline">All entries →</Link>}>
          {data.recent.length === 0 ? (
            <div className="p-6">
              <Empty title="Your diary is empty" action={!sealed && <Link to="/entries/new" className="btn-primary">Write your first entry</Link>}>
                Start with something small: what you ate, who you saw, what you hope for.
              </Empty>
            </div>
          ) : (
            <ul className="divide-y divide-cream-200">
              {data.recent.map((e) => {
                const d = new Date(e.entry_date + 'T00:00')
                return (
                  <li key={e.id}>
                    <Link to={`/entries/${e.id}`} className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-cream-100/60 sm:px-6">
                      <div className="w-14 shrink-0 whitespace-nowrap text-center" aria-hidden>
                        <p className="text-xl font-semibold leading-none text-ink-700">{d.getDate()}</p>
                        <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-bark-500">{d.toLocaleString('en', { month: 'short' })} {String(d.getFullYear()).slice(2)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink-700 group-hover:text-bark-500"><span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title?.trim() || (e.snippet || '').split(/\s+/).slice(0, 7).join(' ') || 'Untitled'}</p>
                        <p className="truncate text-sm text-ink-400">{e.title?.trim() ? e.snippet : (e.snippet || '').split(/\s+/).slice(7).join(' ')}</p>
                      </div>
                      {e.kind === 'letter' && <span className="hidden shrink-0 sm:inline"><Tag>Letter to {e.recipient_name || e.recipient}</Tag></span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <div className="space-y-6">
          <Section title="Vault" actions={<Link to="/vault" className="text-sm font-medium text-bark-500 hover:underline">Details →</Link>}>
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${data.integrity.ok ? 'bg-sage-100 text-sage-600' : 'bg-rose-100 text-rose-600'}`}>
                <NavIcon name={data.integrity.ok ? 'access' : 'close'} size={20} />
              </span>
              <div>
                <p className={`font-semibold ${data.integrity.ok ? 'text-sage-600' : 'text-rose-600'}`}>{data.integrity.ok ? 'Verified' : 'Verification failed'}</p>
                <p className="text-sm text-ink-400">{data.integrity.ok ? `All ${data.integrity.length} records are exactly as saved.` : 'Some records no longer match what was saved.'}</p>
              </div>
            </div>
          </Section>
          <Section title="Themes" description="What you write about most">
            {data.topics.length ? (
              <div className="flex flex-wrap gap-2">
                {data.topics.map(([t, n]) => (
                  <Link key={t} to={`/entries?topic=${t}`} className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-cream-100 px-3 py-1 text-sm text-ink-600 hover:border-bark-500/40 hover:text-bark-600">
                    {t}<span className="text-xs text-ink-400">{n}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="text-sm text-ink-400">Themes appear as you write.</p>}
          </Section>
        </div>
      </div>
    </>
  )
}
