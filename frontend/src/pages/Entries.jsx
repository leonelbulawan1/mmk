import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, LetterBadge, PageHeader, Spinner, Tag } from '../components/ui'
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
      <PageHeader eyebrow="your pages" title="Diary entries" subtitle="Every entry is kept exactly as first written. Corrections are added as revisions."
        actions={!user.death_triggered_at && <>
          <Link to="/entries/new?kind=letter" className="btn-secondary"><NavIcon name="letters" size={16} />New letter</Link>
          <Link to="/entries/new" className="btn-primary"><NavIcon name="write" size={16} />New entry</Link>
        </>} />

      <form role="search" className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row" onSubmit={(e) => { e.preventDefault(); update('q', q.trim()) }}>
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input pl-10 pr-10" type="search" placeholder="Search your words…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search entries" />
          {q && (
            <button type="button" onClick={() => { setQ(''); update('q', '') }} aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-cream-200 hover:text-ink-600">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </div>
        <select className="input sm:w-56" value={kind} onChange={(e) => update('kind', e.target.value)} aria-label="Show">
          <option value="">Entries and letters</option><option value="text">Entries only</option><option value="letter">Letters only</option>
        </select>
        <select className="input sm:w-44" value={oldest ? 'oldest' : ''} onChange={(e) => update('sort', e.target.value)} aria-label="Sort">
          <option value="">Newest first</option><option value="oldest">Oldest first</option>
        </select>
      </form>
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-sm text-ink-400" aria-live="polite">
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
            {reviewOnly
              ? <>Showing {shown.length} {shown.length === 1 ? 'entry' : 'entries'} with suggested fixes to review.</>
              : <>{needReview} {needReview === 1 ? 'entry has' : 'entries have'} suggested fixes waiting for your review.</>}
          </span>
          <button type="button" onClick={() => update('review', reviewOnly ? '' : '1')} className="font-medium underline-offset-2 hover:underline">
            {reviewOnly ? 'Show all entries' : 'Show them'}
          </button>
        </div>
      )}
      {state.error ? <Alert>{state.error}</Alert> : state.loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title="Nothing here yet" action={!user.death_triggered_at && <Link to="/entries/new" className="btn-primary">Write an entry</Link>}>
          {params.get('q') || topic || kind || reviewOnly ? 'No entries match these filters.' : 'Your first page is waiting.'}
        </Empty>
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
                      <p className="mt-1 line-clamp-2 text-ink-500">{e.snippet}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {e.kind === 'letter' && <LetterBadge to={e.recipient_name || e.recipient} />}
                        {e.topics.slice(0, 3).map((t) => <Tag key={t} tone="bark">{t}</Tag>)}
                        {e.revisions > 0 && <span className="text-xs text-ink-400">· {e.revisions} revision{e.revisions > 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
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
