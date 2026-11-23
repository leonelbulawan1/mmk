import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, ConfirmDialog, Empty, Spinner, Tag } from '../components/ui'
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

const PILL = { gold: 'bg-[#FBF0D9] text-bark-600', green: 'bg-sage-100 text-sage-600' }
function Pill({ children, tone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[tone] || 'bg-cream-200 text-ink-500'}`}>{children}</span>
}

// One line in a group: date or icon, title and first line, details on the right, ⋮ menu.
function Row({ to, lead, title, snippet, meta, menu, stack }) {
  return (
    <li className="group flex items-center gap-3 px-4 py-3.5 transition-colors last:rounded-b-2xl hover:bg-cream-100/60 sm:gap-5 sm:px-5">
      <Link to={to} className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
        <div className="shrink-0">{lead}</div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink-700 group-hover:text-bark-500">{title}</h3>
          <p className="truncate text-sm text-ink-500">{snippet}</p>
          <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${stack ? '' : 'md:hidden'}`}>{meta}</div>
        </div>
        {!stack && <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 md:flex">{meta}</div>}
      </Link>
      {menu}
    </li>
  )
}

// All · Diary · Letters, with how many of each.
function KindTabs({ value, counts, onChange }) {
  const tabs = [['', 'All'], ['text', 'Diary'], ['letter', 'Letters']]
  return (
    <div role="tablist" aria-label="Show" className="flex min-h-[46px] flex-1 rounded-xl border border-cream-300 bg-cream-50 p-1 sm:flex-none">
      {tabs.map(([v, label]) => {
        const on = value === v
        return (
          <button key={v || 'all'} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)}
            className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors sm:flex-none ${on ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200 hover:text-ink-700'}`}>
            {label}{counts && <span className={`text-xs ${on ? 'text-cream-200' : 'text-ink-400'}`}>{counts[v]}</span>}
          </button>
        )
      })}
    </div>
  )
}

const shortDate = (iso) => new Date(iso + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })

// Where a letter stands: already on the recipient's home page, waiting for a date, or after passing.
function letterStatus(e) {
  const today = new Date().toLocaleDateString('en-CA')
  if (e.deliver_while_alive && e.release_on) {
    return e.release_on <= today ? { label: 'Sent', tone: 'green' } : { label: `Opens ${shortDate(e.release_on)}`, tone: 'gold' }
  }
  if (e.release_days_after_death) return { label: `${e.release_days_after_death} days after passing` }
  return { label: 'After passing' }
}

// Day number over weekday, at the start of a row.
function DateLead({ iso, month }) {
  const d = new Date(iso + 'T00:00')
  return (
    <div className="w-10 text-center" aria-hidden>
      <p className="text-2xl font-semibold leading-none text-ink-700">{d.getDate()}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-bark-500">{d.toLocaleString('en', month ? { month: 'short' } : { weekday: 'short' })}</p>
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
  // The floating composer saves drafts while it is open; read them again once it closes.
  useEffect(() => { setDraftList(drafts.list(user.id)) }, [location.key, user.id])
  const deleteDraft = () => { drafts.remove(user.id, toDelete.id); setDraftList(drafts.list(user.id)); setToDelete(null) }
  useEffect(() => setLimit(PAGE), [params])

  useEffect(() => {
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ q: params.get('q') || '', topic })
    setState((s) => ({ ...s, loading: true }))
    api(`/api/entries?${qs}`, { signal: ctrl.signal })
      .then((data) => setState({ loading: false, data, error: '' }))
      .catch((e) => e.name !== 'AbortError' && setState({ loading: false, data: [], error: e.message }))
    return () => ctrl.abort()
  }, [params, topic])

  const update = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }) }

  // Search as you type (after a short pause).
  useEffect(() => {
    const t = setTimeout(() => { if (q.trim() !== (params.get('q') || '')) update('q', q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const needReview = state.data.filter((e) => e.pending_review).length
  const isLetter = (e) => e.kind === 'letter'
  const counts = { '': state.data.length, text: state.data.filter((e) => !isLetter(e)).length, letter: state.data.filter(isLetter).length }
  const filtered = state.data.filter((e) => (!kind || (isLetter(e) ? 'letter' : 'text') === kind) && (!reviewOnly || e.pending_review))
  const sorted = oldest ? [...filtered].reverse() : filtered  // the API returns newest first
  const shown = sorted.slice(0, limit)
  const monthName = (ym) => new Date(ym + '-01T00:00').toLocaleString('en', { month: 'long', year: 'numeric' })

  const rowMenu = (e) => <CardMenu label={e.title || 'Untitled'} items={[
    { label: 'View', icon: isLetter(e) ? 'letters' : 'entries', to: `/entries/${e.id}` },
    ...(user.death_triggered_at ? [] : [{ label: 'Add revision', icon: 'edit', to: `/entries/${e.id}`, state: { revise: true } }])]} />
  const canWrite = !user.death_triggered_at
  const ColumnHead = ({ icon, label, count, note }) => (
    <h2 className="mb-3 flex items-baseline gap-2 px-1 text-lg font-semibold text-ink-700">
      <span className="self-center text-bark-500"><NavIcon name={icon} size={20} /></span>{label}
      <span className="text-sm font-normal text-ink-400">{count}{note && ` · ${note}`}</span>
    </h2>
  )
  const Blank = ({ text, to, action }) => (
    <div className="card mb-6 flex flex-col items-center gap-3 py-8 text-center text-sm text-ink-400">
      {text}{canWrite && !params.get('q') && !topic && <Link to={to} className="btn-secondary">{action}</Link>}
    </div>
  )

  // Diary entries, grouped by month.
  const DiaryColumn = ({ list, heading }) => {
    const groups = list.reduce((acc, e) => { (acc[e.entry_date.slice(0, 7)] ||= []).push(e); return acc }, {})
    const ms = Object.keys(groups).sort()
    if (!oldest) ms.reverse()
    return (
      <div className="min-w-0">
        {heading && <ColumnHead icon="entries" label="Diary entries" count={counts.text} note="Private" />}
        {!list.length && <Blank text="No diary entries here" to="/entries/new" action="Write an entry" />}
        {ms.map((ym) => (
          <section key={ym} className="card mb-6 p-0" aria-labelledby={`m-${ym}`}>
            <GroupHeader id={`m-${ym}`} title={monthName(ym)} count={groups[ym].length} sub={heading} />
            <ol className="divide-y divide-cream-200">
              {groups[ym].map((e) => (
                <Row key={e.id} to={`/entries/${e.id}`} lead={<DateLead iso={e.entry_date} />}
                  title={<><span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title || 'Untitled'}</>}
                  snippet={e.snippet}
                  meta={<>
                    {e.pending_review && <Pill tone="gold">Needs review</Pill>}
                    {e.revisions > 0 && <span className="text-xs text-ink-400">{e.revisions} revision{e.revisions > 1 ? 's' : ''}</span>}
                  </>}
                  menu={rowMenu(e)} />
              ))}
            </ol>
          </section>
        ))}
      </div>
    )
  }

  // Letters, grouped by who they are for, each with where it stands.
  const LetterColumn = ({ list, heading }) => {
    const groups = list.reduce((acc, e) => { const k = e.recipient_name || e.recipient || 'Unknown'; (acc[k] ||= []).push(e); return acc }, {})
    const people = Object.keys(groups).sort((a, b) => a.localeCompare(b))
    return (
      <div className="min-w-0">
        {heading && <ColumnHead icon="letters" label="Letters" count={counts.letter} note="For your beneficiaries" />}
        {!list.length && <Blank text="No letters here" to="/entries/new?kind=letter" action="Write a letter" />}
        {people.map((who) => (
          <section key={who} className="card mb-6 p-0" aria-labelledby={`to-${who}`}>
            <GroupHeader id={`to-${who}`} title={`To ${who}`} count={groups[who].length} sub={heading} />
            <ol className="divide-y divide-cream-200">
              {groups[who].map((e) => {
                const st = letterStatus(e)
                return (
                  <Row key={e.id} to={`/entries/${e.id}`} lead={<DateLead iso={e.entry_date} month />}
                    title={<><span className="sr-only">{fmtDate(e.entry_date)}: </span>{e.title || 'Untitled'}</>}
                    snippet={e.snippet}
                    meta={<>
                      {e.pending_review && <Pill tone="gold">Needs review</Pill>}
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </>}
                    menu={rowMenu(e)} stack={heading} />
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    )
  }

  return (
    <>
      <h1 className="sr-only">Entry</h1>
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
        </div>
        <div className="flex gap-2 sm:gap-3">
          <KindTabs value={kind} counts={state.loading ? null : counts} onChange={(v) => update('kind', v)} />
          <select className="input w-auto shrink-0 sm:w-36" value={oldest ? 'oldest' : ''} onChange={(e) => update('sort', e.target.value)} aria-label="Sort">
            <option value="">Newest</option><option value="oldest">Oldest</option>
          </select>
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
          <section className="card mb-6 p-0" aria-labelledby="drafts-h">
            <GroupHeader id="drafts-h" title="Drafts" count={list.length} note="Only on this device" />
            <ul className="divide-y divide-cream-200">
              {list.map((d) => {
                const letter = d.form.kind === 'letter'
                const saved = d.saved_at ? new Date(d.saved_at) : null
                const to = `/entries/new?draft=${d.id}${letter ? '&kind=letter' : ''}`
                return (
                  <li key={d.id} className="group flex items-center gap-3 px-4 py-1.5 transition-colors last:rounded-b-2xl hover:bg-cream-100/60 sm:px-5">
                    <Link to={to} state={{ background: location }} className="flex min-w-0 flex-1 items-center gap-3 py-1.5">
                      <span className="shrink-0 text-ink-400"><NavIcon name={letter ? 'letters' : 'write'} size={18} /></span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-semibold text-ink-700 group-hover:text-bark-500">{d.form.title?.trim() || 'Untitled'}</span>
                        <span className="text-ink-400"> · {d.form.text?.trim() || '…'}</span>
                      </span>
                      <span className="hidden shrink-0 sm:inline"><Pill>{letter ? 'Letter draft' : 'Draft'}</Pill></span>
                      {saved && <span className="hidden shrink-0 text-xs text-ink-400 md:inline">{saved.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                    </Link>
                    <CardMenu label={d.form.title?.trim() || 'Untitled draft'} items={[
                      { label: 'Edit', icon: 'edit', to },
                      { label: 'Delete', icon: 'trash', danger: true, onClick: () => setToDelete(d) }]} />
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })()}
      {state.error ? <Alert>{state.error}</Alert> : state.loading ? <Spinner /> : shown.length === 0 ? (
        <Empty title={params.get('q') || topic || kind || reviewOnly ? 'No matches' : 'No entries yet'}
          action={!user.death_triggered_at && !(params.get('q') || topic || kind || reviewOnly) && <Link to="/entries/new" className="btn-primary">New entry</Link>} />
      ) : (
        <div className={!kind ? 'grid items-start gap-x-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''}>
          {(!kind || kind === 'text') && DiaryColumn({ list: shown.filter((e) => !isLetter(e)), heading: !kind })}
          {(!kind || kind === 'letter') && LetterColumn({ list: shown.filter(isLetter), heading: !kind })}
        </div>
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
