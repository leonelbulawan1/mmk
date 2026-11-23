import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, ConfirmDialog, Empty, LetterBadge, Spinner, Tag } from '../components/ui'
import EntriesTabs from '../components/EntriesTabs'
import NavIcon from '../components/NavIcon'

const PAGE = 30  // entries shown at a time; "Show more" adds the next batch

export default function Entries() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [state, setState] = useState({ loading: true, data: [], error: '' })
  const topic = params.get('topic') || ''
  const kind = params.get('kind') || ''
  const reviewOnly = params.get('review') === '1'
  const oldest = params.get('sort') === 'oldest'
  const [limit, setLimit] = useState(PAGE)
  // Unfinished writing on this device (see api.js drafts); shown above the saved entries.
  const location = useLocation()
  const [draftList, setDraftList] = useState(() => drafts.list(user.id))
  const [toDelete, setToDelete] = useState(null)
  const deleteDraft = () => { drafts.remove(user.id, toDelete.id); setDraftList(drafts.list(user.id)); setToDelete(null) }
  useEffect(() => setLimit(PAGE), [params])

  useEffect(() => {
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ q: params.get('q') || '', topic, kind })
    setState((s) => ({ ...s, loading: true }))
    api(`/api/entries?${qs}`, { signal: ctrl.signal })
      .then((data) => setState({ loading: false, data, error: '' }))
      .catch((e) => e.name !== 'AbortError' && setState({ loading: false, data: [], error: e.message }))
    return () => ctrl.abort()
  }, [params, topic, kind])

  const update = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }) }

  // Search as you type (after a short pause).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== (params.get('q') || '')) update('q', q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const needReview = state.data.filter((e) => e.pending_review).length
  const filtered = reviewOnly ? state.data.filter((e) => e.pending_review) : state.data
  const sorted = oldest ? [...filtered].reverse() : filtered  // the API returns newest first
  const shown = sorted.slice(0, limit)
  // group entries by year for a journal feel
  const byYear = shown.reduce((acc, e) => { (acc[e.entry_date.slice(0, 4)] ||= []).push(e); return acc }, {})
  const years = Object.keys(byYear).sort()
  if (!oldest) years.reverse()

  return (
    <>
      <h1 className="sr-only">Diary entries</h1>
      <EntriesTabs active="list" canWrite={!user.death_triggered_at} />
      {location.state?.draftSaved && <div className="mb-4"><Alert kind="success">Saved to Drafts.</Alert></div>}

      <form role="search" className="mb-3 grid gap-3 sm:grid-cols-[1fr_11rem_11rem]" onSubmit={(e) => { e.preventDefault(); update('q', q.trim()) }}>
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input pl-10 pr-10" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search entries" />
          {q && (
            <button type="button" onClick={() => { setQ(''); update('q', '') }} aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-cream-200 hover:text-ink-600">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>
        <select className="input" value={kind} onChange={(e) => update('kind', e.target.value)} aria-label="Show">
          <option value="">All</option><option value="text">Entries</option><option value="letter">Letters</option>
        </select>
        <select className="input" value={oldest ? 'oldest' : ''} onChange={(e) => update('sort', e.target.value)} aria-label="Sort">
          <option value="">Newest</option><option value="oldest">Oldest</option>
        </select>
      </form>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-xs text-ink-400" aria-live="polite">
        {!state.loading && (
          <span>
            {filtered.length} {filtered.length === 1 ? (kind === 'letter' ? 'letter' : 'entry') : (kind === 'letter' ? 'letters' : 'entries')}
            {params.get('q') && <> matching <b className="font-medium text-ink-600">“{params.get('q')}”</b></>}
          </span>
        )}
        {topic && <span className="flex items-center gap-1.5">· theme <Tag tone="bark">{topic}</Tag>
          <button type="button" className="text-xs font-medium text-bark-500 hover:underline" onClick={() => update('topic', '')}>clear</button></span>}
      </div>

      <Alert>{state.error}</Alert>
      {!state.loading && (needReview > 0 || reviewOnly) && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/30 bg-[#FBF0D9] px-4 py-3 text-sm text-bark-600">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-gold-500" />
            {reviewOnly ? 'Needs review' : <>{needReview} need{needReview === 1 ? 's' : ''} review</>}
          </span>
          <button type="button" onClick={() => update('review', reviewOnly ? '' : '1')} className="font-medium underline-offset-2 hover:underline">
            {reviewOnly ? 'Show all' : 'Show'}
          </button>
        </div>
      )}
      {!user.death_triggered_at && !params.get('q') && !reviewOnly && (() => {
        const list = draftList.filter((d) => !kind || (d.form.kind || 'text') === kind)
        if (!list.length) return null
        return (
          <section className="mb-10" aria-labelledby="drafts-h">
            <h2 id="drafts-h" className="mb-3 text-xl font-semibold text-bark-500">Drafts <span className="text-sm font-normal text-ink-400">({list.length})</span></h2>
            <ol className="space-y-3">
              {list.map((d) => {
                const letter = d.form.kind === 'letter'
                const saved = d.saved_at ? new Date(d.saved_at) : null
                return (
                  <li key={d.id} className="card flex items-center gap-4 border-dashed p-4 sm:gap-6 sm:p-5">
                    <div className="w-12 shrink-0 text-center sm:w-14" aria-hidden>
                      <NavIcon name={letter ? 'letters' : 'write'} size={22} />
                    </div>
                    <Link to={`/entries/new?draft=${d.id}${letter ? '&kind=letter' : ''}`} className="group min-w-0 flex-1">
                      <h3 className="text-lg font-semibold group-hover:text-bark-500 sm:text-xl">{d.form.title?.trim() || 'Untitled'}</h3>
                      <p className="mt-1 line-clamp-1 text-ink-500">{d.form.text?.trim() || '…'}</p>
                      <p className="mt-2 text-xs text-ink-400">
                        <span className="mr-2 rounded-full bg-cream-200 px-2 py-0.5 font-medium text-ink-500">Draft{letter ? ' · letter' : ''}</span>
                        {saved && <>Saved {saved.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
                      </p>
                    </Link>
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                      <Link to={`/entries/new?draft=${d.id}${letter ? '&kind=letter' : ''}`} className="btn-secondary px-3 py-1.5 text-sm">Continue</Link>
                      <button type="button" onClick={() => setToDelete(d)} className="btn-ghost px-3 py-1.5 text-sm text-rose-600">Delete</button>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })()}
      {state.error ? <Alert>{state.error}</Alert> : state.loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title={params.get('q') || topic || kind || reviewOnly ? 'No matches' : 'No entries yet'}
          action={!user.death_triggered_at && !(params.get('q') || topic || kind || reviewOnly) && <Link to="/entries/new" className="btn-primary">New entry</Link>} />
      ) : (
        years.map((year) => (
          <section key={year} className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-bark-500">{year}</h2>
            <ol className="space-y-3">
              {byYear[year].map((e) => (
                <li key={e.id}>
                  <Link to={`/entries/${e.id}`} className="card group flex gap-4 p-4 transition hover:-translate-y-0.5 sm:gap-6 sm:p-5">
                    <div className="w-12 shrink-0 text-center sm:w-14" aria-hidden>
                      <p className="text-xs font-medium uppercase tracking-wider text-bark-500">{new Date(e.entry_date + 'T00:00').toLocaleString('en', { month: 'short' })}</p>
                      <p className="text-2xl font-semibold leading-tight text-ink-700 sm:text-3xl">{Number(e.entry_date.slice(8, 10))}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <h3 className="text-lg font-semibold group-hover:text-bark-500 sm:text-xl">
                          <span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title || 'Untitled'}
                        </h3>
                        {e.pending_review && (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gold-500/40 bg-[#FBF0D9] px-2.5 py-0.5 text-xs font-medium text-bark-600">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-500" />Needs review
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-1 text-ink-500">{e.snippet}</p>
                      {e.kind === 'letter' && <div className="mt-2"><LetterBadge to={e.recipient_name || e.recipient} /></div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      <ConfirmDialog open={!!toDelete} danger title="Delete this draft?" confirmLabel="Delete" cancelLabel="Keep it"
        onConfirm={deleteDraft} onCancel={() => setToDelete(null)}>
        “{toDelete?.form.title?.trim() || 'Untitled'}” will be deleted from this device. This can’t be undone.
      </ConfirmDialog>
      {!state.loading && filtered.length > shown.length && (
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => setLimit((n) => n + PAGE)}>
            Show more ({filtered.length - shown.length} more)
          </button>
        </div>
      )}
    </>
  )
}
