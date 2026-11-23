import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, ConfirmDialog, Empty, LetterBadge, Spinner, Tag } from '../components/ui'
import NavIcon from '../components/NavIcon'

// "⋮" menu on a card. items: [{ label, icon, to } | { label, icon, onClick, danger }].
// Closes on Escape, on a click outside, or after a choice.
function CardMenu({ items, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    ref.current?.querySelector('[role=menuitem]')?.focus()
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const cls = (danger) => `flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-cream-200 focus:bg-cream-200 focus:outline-none ${danger ? 'text-rose-600' : 'text-ink-700'}`
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`Options for ${label}`}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 hover:bg-cream-200">
        <NavIcon name="more" size={20} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-20 w-44 overflow-hidden rounded-xl border border-cream-300 bg-cream-50 py-1 shadow-paper">
          {items.map((it) => it.to
            ? <Link key={it.label} role="menuitem" to={it.to} state={it.state} className={cls(it.danger)}><NavIcon name={it.icon} size={16} />{it.label}</Link>
            : <button key={it.label} role="menuitem" type="button" onClick={() => { setOpen(false); it.onClick() }} className={cls(it.danger)}><NavIcon name={it.icon} size={16} />{it.label}</button>)}
        </div>
      )}
    </div>
  )
}

function GroupHeader({ id, title, count, note, sub }) {
  const H = sub ? 'h3' : 'h2'
  return (
    <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-cream-300 bg-cream-100/70 px-4 py-2.5 sm:px-5">
      <H id={id} className="text-sm font-semibold uppercase tracking-wider text-ink-600">{title}</H>
      <span className="text-xs text-ink-400">{note ? `${note} · ` : ''}{count} {count === 1 ? 'item' : 'items'}</span>
    </div>
  )
}

function Pill({ children, tone }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone === 'gold' ? 'bg-[#FBF0D9] text-bark-600' : 'bg-cream-200 text-ink-500'}`}>{children}</span>
}

// One line in a group: date or icon, title and first line, details on the right, ⋮ menu.
function Row({ to, lead, title, snippet, meta, menu }) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3.5 transition-colors last:rounded-b-2xl hover:bg-cream-100/60 sm:gap-5 sm:px-5">
      <Link to={to} className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
        <div className="shrink-0">{lead}</div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink-700 group-hover:text-bark-500">{title}</h3>
          <p className="truncate text-sm text-ink-500">{snippet}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">{meta}</div>
        </div>
        <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 md:flex">{meta}</div>
      </Link>
      {menu}
    </li>
  )
}

// "+ New" button with a small menu: Diary entry or Letter.
function NewMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    ref.current?.querySelector('[role=menuitem]')?.focus()
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const item = 'flex items-start gap-3 px-4 py-3 hover:bg-cream-200 focus:bg-cream-200 focus:outline-none'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="btn-primary h-full min-h-[46px] whitespace-nowrap px-4">
        <span aria-hidden className="text-lg leading-none">+</span>New
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-cream-300 bg-cream-50 py-1 shadow-paper">
          <Link role="menuitem" to="/entries/new" className={item}>
            <span className="mt-0.5 text-ink-500"><NavIcon name="write" size={18} /></span>
            <span><span className="block text-sm font-medium text-ink-700">Diary entry</span><span className="block text-xs text-ink-400">Private, for your diary</span></span>
          </Link>
          <Link role="menuitem" to="/entries/new?kind=letter" className={item}>
            <span className="mt-0.5 text-ink-500"><NavIcon name="letters" size={18} /></span>
            <span><span className="block text-sm font-medium text-ink-700">Letter</span><span className="block text-xs text-ink-400">To one of your beneficiaries</span></span>
          </Link>
        </div>
      )}
    </div>
  )
}

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
  // A line under the sticky toolbar once the list has scrolled beneath it.
  const stickyTop = useRef(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = stickyTop.current
    if (!el || !('IntersectionObserver' in window)) return undefined
    const io = new IntersectionObserver(([en]) => setStuck(!en.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])
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
  const monthName = (ym) => new Date(ym + '-01T00:00').toLocaleString('en', { month: 'long', year: 'numeric' })

  return (
    <>
      <h1 className="sr-only">Diary entries</h1>
      {/* Tabs, search and filters stay at the top while the list scrolls under them. */}
      <div ref={stickyTop} aria-hidden className="h-px" />
      <div className={`sticky top-0 z-30 -mx-4 -mt-8 mb-5 bg-cream-100/95 px-4 pb-3 pt-4 backdrop-blur transition-shadow sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-12 lg:px-8 lg:pt-6 ${stuck ? 'border-b border-cream-300 shadow-[0_6px_16px_-12px_rgba(31,42,68,0.35)]' : ''}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <div className="flex flex-1 gap-2">
          <form role="search" className="relative flex-1" onSubmit={(e) => { e.preventDefault(); update('q', q.trim()) }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input className="input pl-10 pr-10" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search entries" />
            {q && (
              <button type="button" onClick={() => { setQ(''); update('q', '') }} aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-cream-200 hover:text-ink-600">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </form>
          {!user.death_triggered_at && <div className="sm:hidden"><NewMenu /></div>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
          <select className="input sm:w-40" value={kind} onChange={(e) => update('kind', e.target.value)} aria-label="Show">
            <option value="">All</option><option value="text">Entries</option><option value="letter">Letters</option>
          </select>
          <select className="input sm:w-40" value={oldest ? 'oldest' : ''} onChange={(e) => update('sort', e.target.value)} aria-label="Sort">
            <option value="">Newest</option><option value="oldest">Oldest</option>
          </select>
          {!user.death_triggered_at && <div className="hidden sm:block"><NewMenu /></div>}
        </div>
      </div>
      </div>
      {location.state?.draftSaved && <div className="mb-4"><Alert kind="success">Moved to Drafts. You can continue it any time.</Alert></div>}
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-xs text-ink-400" aria-live="polite">
        {!state.loading && (params.get('q') || topic) && (
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
          <section className="card mb-8 p-0" aria-labelledby="drafts-h">
            <GroupHeader id="drafts-h" title="Drafts" count={list.length} note="Only on this device" />
            <ol className="divide-y divide-cream-200">
              {list.map((d) => {
                const letter = d.form.kind === 'letter'
                const saved = d.saved_at ? new Date(d.saved_at) : null
                const to = `/entries/new?draft=${d.id}${letter ? '&kind=letter' : ''}`
                return (
                  <Row key={d.id} to={to}
                    lead={<span className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-cream-300 text-ink-400"><NavIcon name={letter ? 'letters' : 'write'} size={18} /></span>}
                    title={d.form.title?.trim() || 'Untitled'} snippet={d.form.text?.trim() || '…'}
                    meta={<>
                      <Pill>{letter ? 'Letter draft' : 'Draft'}</Pill>
                      {saved && <span className="text-xs text-ink-400">{saved.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                    </>}
                    menu={<CardMenu label={d.form.title?.trim() || 'Untitled draft'} items={[
                      { label: 'Edit', icon: 'edit', to },
                      { label: 'Delete', icon: 'trash', danger: true, onClick: () => setToDelete(d) }]} />} />
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
        // Diary entries and letters are kept apart, each grouped by month.
        [['text', 'Diary entries'], ['letter', 'Letters']].map(([k, label]) => {
          const list = shown.filter((e) => (e.kind === 'letter' ? 'letter' : 'text') === k)
          if (!list.length) return null
          const groups = list.reduce((acc, e) => { (acc[e.entry_date.slice(0, 7)] ||= []).push(e); return acc }, {})
          const ms = Object.keys(groups).sort()
          if (!oldest) ms.reverse()
          return (
            <div key={k} className="mb-10">
              {!kind && (
                <h2 className="mb-3 flex items-center gap-2 px-1 text-lg font-semibold text-ink-700">
                  <span className="text-bark-500"><NavIcon name={k === 'letter' ? 'letters' : 'entries'} size={20} /></span>
                  {label}<span className="text-sm font-normal text-ink-400">· {list.length}</span>
                </h2>
              )}
              {ms.map((ym) => (
                <section key={ym} className="card mb-6 p-0" aria-labelledby={`m-${k}-${ym}`}>
                  <GroupHeader id={`m-${k}-${ym}`} title={monthName(ym)} count={groups[ym].length} sub={!kind} />
                  <ol className="divide-y divide-cream-200">
                    {groups[ym].map((e) => {
                    const d = new Date(e.entry_date + 'T00:00')
                    return (
                      <Row key={e.id} to={`/entries/${e.id}`}
                        lead={<div className="w-10 text-center" aria-hidden>
                          <p className="text-2xl font-semibold leading-none text-ink-700">{d.getDate()}</p>
                          <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-bark-500">{d.toLocaleString('en', { weekday: 'short' })}</p>
                        </div>}
                        title={<><span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title || 'Untitled'}</>}
                        snippet={e.snippet}
                        meta={<>
                          {e.pending_review && <Pill tone="gold">Needs review</Pill>}
                          {e.kind === 'letter' && <LetterBadge to={e.recipient_name || e.recipient} />}
                          {e.revisions > 0 && <span className="text-xs text-ink-400">{e.revisions} revision{e.revisions > 1 ? 's' : ''}</span>}
                        </>}
                        menu={<CardMenu label={e.title || 'Untitled'} items={[
                          { label: 'View', icon: e.kind === 'letter' ? 'letters' : 'entries', to: `/entries/${e.id}` },
                          ...(user.death_triggered_at ? [] : [{ label: 'Add revision', icon: 'edit', to: `/entries/${e.id}`, state: { revise: true } }])]} />} />
                    )
                    })}
                  </ol>
                </section>
              ))}
            </div>
          )
        })
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
