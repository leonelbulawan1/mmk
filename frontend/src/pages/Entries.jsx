import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, PageHeader, Spinner, Tag } from '../components/ui'

const MODE_LABEL = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

export default function Entries() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [state, setState] = useState({ loading: true, data: [], error: '' })
  const topic = params.get('topic') || ''
  const kind = params.get('kind') || ''

  useEffect(() => {
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ q: params.get('q') || '', topic, kind })
    setState((s) => ({ ...s, loading: true }))
    api(`/api/entries?${qs}`, { signal: ctrl.signal })
      .then((data) => setState({ loading: false, data, error: '' }))
      .catch((e) => e.name !== 'AbortError' && setState({ loading: false, data: [], error: e.message }))
    return () => ctrl.abort()
  }, [params, topic, kind])

  const update = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p) }

  // group entries by year for a journal feel
  const byYear = state.data.reduce((acc, e) => { (acc[e.entry_date.slice(0, 4)] ||= []).push(e); return acc }, {})

  return (
    <>
      <PageHeader eyebrow="your pages" title="Diary entries" subtitle="Every entry is kept exactly as first written. Corrections are added as revisions."
        actions={!user.death_triggered_at && <Link to="/write" className="btn-primary">✎ New entry</Link>} />

      <form className="card mb-8 flex flex-col gap-3 p-4 sm:flex-row" onSubmit={(e) => { e.preventDefault(); update('q', q) }}>
        <input className="input flex-1" placeholder="Search your words…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input sm:w-40" value={kind} onChange={(e) => update('kind', e.target.value)} aria-label="Kind">
          <option value="">All kinds</option><option value="text">Entries</option><option value="letter">Letters</option>
        </select>
        <button className="btn-secondary">Search</button>
      </form>
      {topic && <p className="mb-4 text-sm">Theme: <Tag tone="bark">{topic}</Tag> <button className="ml-2 text-xs underline" onClick={() => update('topic', '')}>clear</button></p>}

      <Alert>{state.error}</Alert>
      {state.loading ? <Spinner /> : state.data.length === 0 ? (
        <Empty title="Nothing here yet" action={!user.death_triggered_at && <Link to="/write" className="btn-primary">Write an entry</Link>}>
          {params.get('q') || topic || kind ? 'No entries match these filters.' : 'Your first page is waiting.'}
        </Empty>
      ) : (
        Object.keys(byYear).sort().reverse().map((year) => (
          <section key={year} className="mb-10">
            <h2 className="mb-4 text-2xl font-semibold text-bark-500">{year}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {byYear[year].map((e) => (
                <Link key={e.id} to={`/entries/${e.id}`} className="card group block p-5 transition hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-ink-400">{fmtDate(e.entry_date)}</p>
                      <h3 className="mt-1 text-2xl font-semibold group-hover:text-bark-500">
                        {e.kind === 'letter' && '✉ '}{e.title || 'Untitled'}
                      </h3>
                    </div>
                    {e.pending_review && <Tag tone="bark">review</Tag>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-lg text-ink-500">{e.snippet}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Tag>{MODE_LABEL[e.writing_mode]}</Tag>
                    {e.revisions > 0 && <Tag>{e.revisions} revision{e.revisions > 1 ? 's' : ''}</Tag>}
                    {e.kind === 'letter' && <Tag tone="ink">to {e.recipient}</Tag>}
                    {e.topics.slice(0, 3).map((t) => <Tag key={t} tone="bark">{t}</Tag>)}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
