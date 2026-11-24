import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, PageHeader, Section, Spinner, Tag, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'
import NewMenu from '../components/NewMenu'
import { EntryModal, LetterModal } from '../components/EntryModal'

// A recent item opens in a window: a diary entry with Edit and Delete, a letter read-only.
function Row({ onOpen, className, children }) {
  return <button type="button" onClick={onOpen} className={className}>{children}</button>
}

// One column of the summary strip: label over a number (not a link).
function Stat({ label, value, highlight, className = '' }) {
  return (
    <div className={`border-cream-300 px-5 py-4 text-center sm:px-6 ${className}`}>
      <p className="text-sm font-medium text-ink-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold leading-none ${highlight ? 'text-bark-500' : 'text-ink-700'}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const location = useLocation()
  const { data, error, loading, reload } = useAsync(() => api('/api/dashboard'))
  const [openEntry, setOpenEntry] = useState(null)
  const [openLetter, setOpenLetter] = useState(null)
  const [draftList, setDraftList] = useState(() => drafts.list(user.id))
  useEffect(() => { if (!user.death_triggered_at) drafts.sync(user.id).then(setDraftList) }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Spinner label="Loading your dashboard" />
  if (error) return <Alert>{error}</Alert>
  const sealed = !!data.death_triggered_at
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const draft = draftList[0]

  return (
    // The page itself does not scroll: it fills the window, and only the Recent entries list scrolls.
    // (Window height minus the page padding, and on small screens the top bar.)
    <div className="flex h-[calc(100dvh-103px)] min-h-[520px] flex-col lg:h-[calc(100dvh-36px)]">
      <div className="shrink-0">
      <PageHeader eyebrow={`${greeting},`} title={data.owner}
        subtitle={sealed ? 'Vault sealed.' : 'What would you like to remember today?'}
        actions={!sealed && <NewMenu label="Write" icon="write" />} />

      {draft && !sealed && (
        <div className="card mb-4 flex flex-wrap items-center gap-4 px-5 py-4 fade-in">
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

      <div className="border-b border-cream-300 pb-4">
      <div className="card grid grid-cols-2 overflow-hidden p-0 lg:grid-cols-4">
        <Stat label="Diary entries" value={data.entry_count} className="border-b border-r lg:border-b-0" />
        <Stat label="Letters" value={data.letter_count} className="border-b lg:border-b-0 lg:border-r" />
        <Stat label="Beneficiaries" value={data.beneficiary_count} className="border-r" />
        <Stat label="Needs review" value={data.pending_reviews} highlight={data.pending_reviews > 0} />
      </div>
      </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <Section className="flex min-h-0 min-w-0 flex-1 flex-col" title="Recent entries" bodyClassName="relative min-h-0 flex-1 overflow-y-auto p-0"
          actions={<Link to="/entries" className="link inline-flex items-center gap-1.5">View all<NavIcon name="arrow-right" size={14} /></Link>}>
          {data.recent.length === 0 ? (
            <div className="p-6">
              <Empty title="Your diary is empty" action={!sealed && <Link to="/entries/new" className="btn-primary">Write your first entry</Link>} />
            </div>
          ) : (
            <ul className="divide-y divide-cream-200">
              {data.recent.map((e) => {
                const d = new Date(e.entry_date + 'T00:00')
                return (
                  <li key={e.id}>
                    <Row onOpen={() => (e.kind === 'letter' ? setOpenLetter(e) : setOpenEntry(e))} className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-cream-100/60 sm:px-6">
                      <div className="w-14 shrink-0 whitespace-nowrap text-center" aria-hidden>
                        <p className="text-2xl font-semibold leading-none text-ink-700">{d.getDate()}</p>
                        <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-bark-500">{d.toLocaleString('en', { month: 'short' })} {String(d.getFullYear()).slice(2)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink-700 group-hover:text-bark-500"><span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title?.trim() || (e.snippet || '').split(/\s+/).slice(0, 7).join(' ') || 'Untitled'}</p>
                        <p className="truncate text-sm text-ink-400">{e.title?.trim() ? e.snippet : (e.snippet || '').split(/\s+/).slice(7).join(' ')}</p>
                      </div>
                      {e.kind === 'letter' && <span className="hidden shrink-0 sm:inline"><Tag>Letter to {e.recipient_name || e.recipient}</Tag></span>}
                      {e.created_at && new Date(e.created_at).toLocaleDateString('en-CA') === e.entry_date && <time dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()} className="shrink-0 whitespace-nowrap text-xs text-ink-400">
                        {new Date(e.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </time>}
                    </Row>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

      </div>
      <LetterModal letter={openLetter} onClose={() => setOpenLetter(null)} />
      <EntryModal entry={openEntry} onClose={() => setOpenEntry(null)} onDeleted={() => { setOpenEntry(null); reload() }} />
    </div>
  )
}
