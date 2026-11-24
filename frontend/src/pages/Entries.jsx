import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api, drafts, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, ConfirmDialog, Empty, Spinner, Tag, useToast } from '../components/ui'
import { DraftModal, EntryModal, LetterModal } from '../components/EntryModal'
import NavIcon from '../components/NavIcon'

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
function Row({ to, lead, title, snippet, meta, menu, stack, linkState, onOpen }) {
  const Open = onOpen ? 'button' : Link
  const openProps = onOpen ? { type: 'button', onClick: onOpen } : { to, state: linkState }
  return (
    <li className="group flex items-center gap-3 border-b border-cream-300 px-4 py-3.5 transition-colors last:rounded-b-2xl last:border-b-0 hover:bg-cream-100/60 sm:gap-5 sm:px-5">
      <Open {...openProps} className="flex min-w-0 flex-1 items-center gap-4 text-left sm:gap-5">
        <div className="shrink-0">{lead}</div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink-700 group-hover:text-bark-500">{title}</h3>
          <p className="truncate text-sm text-ink-500">{snippet}</p>
          <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${stack ? '' : 'md:hidden'}`}>{meta}</div>
        </div>
        {!stack && <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 md:flex">{meta}</div>}
      </Open>
      {menu}
    </li>
  )
}

// All · Diary · Letters, with how many of each.
function KindTabs({ value, counts, onChange, review }) {
  const tabs = [['all', 'All'], ['text', 'Diary'], ['letter', 'Letters'], ['draft', 'Drafts'], ...(review ? [['review', 'Needs review']] : [])]
  return (
    <div role="tablist" aria-label="Show" className="flex h-[42px] min-w-0 flex-1 overflow-x-auto rounded-xl border border-cream-300 bg-cream-50 p-1 sm:flex-none">
      {tabs.map(([v, label]) => {
        const on = value === v
        return (
          <button key={v} type="button" role="tab" aria-selected={on} onClick={() => onChange(v)}
            className={`flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-sm sm:gap-1.5 sm:px-3 font-medium transition-colors sm:flex-none ${on ? 'bg-ink-700 text-cream-50' : v === 'review' ? 'text-bark-600 hover:bg-[#FBF0D9]' : 'text-ink-500 hover:bg-cream-200 hover:text-ink-700'}`}>
            {v === 'review' && !on && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-500" />}
            {v === 'review' ? <><span className="sm:hidden">Review</span><span className="hidden sm:inline">Needs review</span></> : label}
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

// An entry without a title is shown by its first words.
const titleOf = (e) => e.title?.trim() || (e.snippet || '').split(/\s+/).slice(0, 7).join(' ') + ((e.snippet || '').split(/\s+/).length > 7 ? '…' : '') || 'Untitled'

// A light divider inside a card: month or recipient, with a count.
// Stays under the toolbar while its rows scroll past, so you always know which month you're in.
function Divider({ id, title, top = 0 }) {
  return (
    <li id={id} style={{ top, scrollMarginTop: top + 8 }}
      className="sticky z-10 flex items-center justify-between gap-3 border-b border-cream-300 bg-cream-100 px-4 py-2 first:rounded-t-2xl sm:px-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</h3>
    </li>
  )
}

// The line under the title; for an untitled entry, the words after the ones used as its title.
const snippetOf = (e) => e.title?.trim() ? e.snippet : (e.snippet || '').split(/\s+/).slice(7).join(' ')

// When it was written, as a time of day (the date is already on the left of the row).
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')
const Time = ({ iso, title }) => iso ? <time dateTime={iso} title={title || new Date(iso).toLocaleString()} className="whitespace-nowrap text-xs text-ink-400">{timeOf(iso)}</time> : null

// Marks the words being searched for.
function Mark({ text, q }) {
  const words = (q || '').trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length || !text) return text || null
  const parts = String(text).split(new RegExp(`(${words.join('|')})`, 'gi'))
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-[#FBF0D9] px-0.5 text-inherit">{p}</mark> : p))
}

const PAGE = 30  // entries shown at a time; "Show more" adds the next batch

export default function Entries() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  // Height of the sticky toolbar, so the month dividers stick just below it.
  const barRef = useRef(null)
  const searchRef = useRef(null)
  const clearSearch = () => { setQ(''); update('q', ''); searchRef.current?.focus() }
  const [barH, setBarH] = useState(0)
  useEffect(() => {
    const el = barRef.current
    if (!el || !('ResizeObserver' in window)) return undefined
    const ro = new ResizeObserver(() => setBarH(Math.round(el.getBoundingClientRect().height) - 12))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [state, setState] = useState({ loading: true, data: [], error: '' })
  const topic = params.get('topic') || ''
  const reviewOnly = params.get('review') === '1'
  // Tabs: Diary (the default), Letters, Drafts; "Needs review" shows both kinds that need review.
  // Tabs: All (the default: diary and letters side by side), Diary, Letters, Drafts; "Needs review" shows both kinds that need review.
  const kind = reviewOnly ? '' : ['text', 'letter', 'draft'].includes(params.get('kind')) ? params.get('kind') : 'all'
  const both = kind === 'all' || reviewOnly
  const oldest = params.get('sort') === 'oldest'
  const [limit, setLimit] = useState(PAGE)
  // Unfinished writing (see api.js drafts): on this device and on the server.
  const location = useLocation()
  const [draftList, setDraftList] = useState(() => drafts.list(user.id))
  const [toDelete, setToDelete] = useState(null)
  const [openEntry, setOpenEntry] = useState(null)   // diary entry shown in the modal
  const [openDraft, setOpenDraft] = useState(null)   // draft shown in the modal
  const [openLetter, setOpenLetter] = useState(null) // letter shown in the modal
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
  // Drafts from other devices (and ones deleted there) arrive from the server.
  useEffect(() => { if (user.role === 'owner' && !user.death_triggered_at) drafts.sync(user.id).then(setDraftList) }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const toast = useToast()
  const deleteDraft = () => { drafts.remove(user.id, toDelete.id); setDraftList(drafts.list(user.id)); setToDelete(null); setOpenDraft(null); toast('Draft deleted.') }
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
  const counts = { all: state.data.length, text: state.data.filter((e) => !isLetter(e)).length, letter: state.data.filter(isLetter).length, draft: draftList.length, review: needReview }
  const filtered = kind === 'draft' ? [] : state.data.filter((e) => (both || (isLetter(e) ? 'letter' : 'text') === kind) && (!reviewOnly || e.pending_review))
  const ql = (params.get('q') || '').toLowerCase()
  const draftShown = draftList.filter((d) => !ql || `${d.form.title || ''} ${d.form.text || ''}`.toLowerCase().includes(ql))
  const sorted = oldest ? [...filtered].reverse() : filtered  // the API returns newest first
  const shown = sorted.slice(0, limit)
  const monthName = (ym) => new Date(ym + '-01T00:00').toLocaleString('en', { month: 'long', year: 'numeric' })

  const canWrite = !user.death_triggered_at
  const ColumnHead = ({ label }) => (
    <h2 className="mb-3 px-1 text-lg font-semibold text-ink-700">{label}</h2>
  )
  const Blank = ({ text, to, action }) => (
    <div className="card mb-6 flex flex-col items-center gap-3 py-8 text-center text-sm text-ink-400">
      {text}{canWrite && !params.get('q') && !topic && <Link to={to} className="btn-secondary">{action}</Link>}
    </div>
  )

  // Diary entries: one card, a divider for each month.
  const DiaryColumn = ({ list, heading }) => {
    const groups = list.reduce((acc, e) => { (acc[e.entry_date.slice(0, 7)] ||= []).push(e); return acc }, {})
    const ms = Object.keys(groups).sort()
    if (!oldest) ms.reverse()
    const seenYear = new Set()
    return (
      <div className="min-w-0">
        {heading && <ColumnHead label="Diary entries" />}
        {!list.length ? <Blank text="No diary entries here" to="/entries/new" action="Write an entry" /> : (
          <div className="card mb-6 p-0">
            <ol>
              {ms.map((ym) => {
                const y = ym.slice(0, 4)
                const first = !seenYear.has(y); seenYear.add(y)
                return [
                  <Divider key={`d-${ym}`} id={first ? `year-${y}` : undefined} title={monthName(ym)} top={barH} />,
                  ...groups[ym].map((e) => (
                    <Row key={e.id} onOpen={() => setOpenEntry(e)} lead={<DateLead iso={e.entry_date} />}
                      title={<><span className="sr-only">{fmtDate(e.entry_date)}: </span><Mark text={titleOf(e)} q={ql} /></>}
                      snippet={<Mark text={snippetOf(e)} q={ql} />}
                      meta={<>
                        {e.pending_review && <Pill tone="gold">Needs review</Pill>}
                        <Time iso={e.created_at} />
                      </>} />
                  )),
                ]
              })}
            </ol>
          </div>
        )}
      </div>
    )
  }

  // Letters: one card, a divider for each recipient; stays in view beside a long diary.
  const LetterColumn = ({ list, heading }) => {
    const groups = list.reduce((acc, e) => { const k = e.recipient_name || e.recipient || 'Unknown'; (acc[k] ||= []).push(e); return acc }, {})
    const people = Object.keys(groups).sort((a, b) => a.localeCompare(b))
    return (
      <div className="min-w-0">
        {heading && <ColumnHead label="Letters" />}
        {!list.length ? <Blank text="No letters here" to="/entries/new?kind=letter" action="Write a letter" /> : (
          <div className="card mb-6 p-0">
            <ol>
              {people.map((who) => [
                <Divider key={`p-${who}`} title={`To ${who}`} top={barH} />,
                ...groups[who].map((e) => {
                  const st = letterStatus(e)
                  return (
                    <Row key={e.id} onOpen={() => setOpenLetter(e)} lead={<DateLead iso={e.entry_date} />}
                      title={<><span className="sr-only">{fmtDate(e.entry_date)}: </span><Mark text={titleOf(e)} q={ql} /></>}
                      snippet={<Mark text={snippetOf(e)} q={ql} />}
                      meta={<>
                        {e.pending_review && <Pill tone="gold">Needs review</Pill>}
                        <Pill tone={st.tone}>{st.label}</Pill>
                        <Time iso={e.created_at} />
                      </>} stack={heading} />
                  )
                }),
              ])}
            </ol>
          </div>
        )}
      </div>
    )
  }

  // Years with diary entries, for the "Jump to" bar.
  const years = [...new Set(shown.filter((e) => !isLetter(e)).map((e) => e.entry_date.slice(0, 4)))].sort()
  if (!oldest) years.reverse()
  const jump = (y) => document.getElementById(`year-${y}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Drafts as a list (the Drafts tab, and matching drafts in All while searching).
  const draftCard = (list) => (
          <div className="card mb-6 overflow-hidden p-0">
            <ol>
              {list.map((d) => {
                const letter = d.form.kind === 'letter'
                const saved = d.saved_at ? new Date(d.saved_at) : null
                return (
                  <Row key={d.id} onOpen={() => setOpenDraft(d)}
                    lead={<span className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-cream-300 text-ink-400"><NavIcon name={letter ? 'letters' : 'write'} size={18} /></span>}
                    title={<Mark text={d.form.title?.trim() || 'Untitled'} q={ql} />} snippet={<Mark text={d.form.text?.trim() || '…'} q={ql} />}
                    meta={<>
                      <Pill>{letter ? 'Letter' : 'Diary'}</Pill>
                      {saved && <span className="whitespace-nowrap text-xs text-ink-400">{saved.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
                    </>} />
                )
              })}
            </ol>
          </div>
  )

  return (
    <>
      <h1 className="sr-only">Entry</h1>
      {/* Tabs, search and filters stay at the top while the list scrolls under them. */}
      <div ref={stickyTop} aria-hidden className="h-px" />
      <div ref={barRef} className={`sticky top-0 z-30 -mx-3 -mt-3 mb-3 bg-cream-100/95 px-3 pt-3 backdrop-blur transition-shadow sm:-mx-4 sm:px-4 lg:-mx-5 lg:px-5 ${stuck ? 'border-b border-cream-300 shadow-[0_6px_16px_-12px_rgba(31,42,68,0.35)]' : ''}`}>
      <div className="flex flex-col gap-2 border-b border-cream-300 pb-3 sm:flex-row sm:gap-3">
        <div className="flex flex-1 gap-2">
          <form role="search" className="relative flex-1" onSubmit={(e) => { e.preventDefault(); update('q', q.trim()) }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input ref={searchRef} className="input pl-10 pr-10" type="search" placeholder="Search entries and letters" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); clearSearch() } }} aria-label="Search entries and letters" />
            {q && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" title="Clear search"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 hover:bg-cream-200 hover:text-ink-600">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </form>
        </div>
        <div className="flex gap-2 sm:gap-3">
          <KindTabs value={reviewOnly ? 'review' : kind} counts={state.loading ? null : counts} review={needReview > 0 || reviewOnly}
            onChange={(v) => { const p = new URLSearchParams(params); p.delete('kind'); p.delete('review'); if (v === 'review') p.set('review', '1'); else if (v !== 'all') p.set('kind', v); setParams(p, { replace: true }) }} />
        </div>
      </div>
      </div>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-xs text-ink-400 ${params.get('q') || topic ? 'mb-5' : ''}`} aria-live="polite">
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
      {kind === 'draft' ? (
        !draftShown.length ? (
          <Empty title={ql ? 'No matches' : 'No drafts'}>{ql ? '' : 'When you close something you are writing, it waits here so you can finish it later, on any device.'}</Empty>
        ) : (
          draftCard(draftShown)
        )
      ) : state.error ? <Alert>{state.error}</Alert> : state.loading ? <Spinner label={kind === 'letter' ? 'Loading letters' : 'Loading entries'} /> : shown.length === 0 ? (
        <Empty title={params.get('q') || topic || reviewOnly ? 'No matches' : kind === 'letter' ? 'No letters yet' : kind === 'all' ? 'Nothing written yet' : 'No diary entries yet'}
          action={!user.death_triggered_at && !(params.get('q') || topic || reviewOnly) && <Link to={kind === 'letter' ? '/entries/new?kind=letter' : '/entries/new'} state={{ background: location }} className="btn-primary">{kind === 'letter' ? 'Write a letter' : 'Write an entry'}</Link>} />
      ) : (
        <>
        {(kind === 'text' || kind === 'all') && years.length > 1 && (
          <nav aria-label="Jump to year" className="-mx-1 mb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-1 pb-1 text-sm sm:flex-wrap">
            <span className="mr-1 shrink-0 text-xs font-medium uppercase tracking-wider text-ink-400">Jump to</span>
            {years.map((y) => (
              <button key={y} type="button" onClick={() => jump(y)}
                className="rounded-lg border border-transparent px-2.5 py-1 font-medium text-ink-500 hover:border-cream-300 hover:bg-cream-50 hover:text-ink-700">{y}</button>
            ))}
          </nav>
        )}
        <div>
          {kind === 'all' && ql && draftShown.length > 0 && <><ColumnHead label="Drafts" />{draftCard(draftShown)}</>}
          {(both || kind === 'text') && (!(reviewOnly || ql) || shown.some((e) => !isLetter(e))) && DiaryColumn({ list: shown.filter((e) => !isLetter(e)), heading: both })}
          {(both || kind === 'letter') && (!(reviewOnly || ql) || shown.some(isLetter)) && LetterColumn({ list: shown.filter(isLetter), heading: both })}
        </div>
        </>
      )}
      <EntryModal entry={openEntry} onClose={() => setOpenEntry(null)}
        onDeleted={(id) => { setState((st) => ({ ...st, data: st.data.filter((x) => x.id !== id) })); setOpenEntry(null) }} />
      <LetterModal letter={openLetter} onClose={() => setOpenLetter(null)} />
      <DraftModal draft={toDelete ? null : openDraft} onClose={() => setOpenDraft(null)} onDelete={() => setToDelete(openDraft)} />
      <ConfirmDialog open={!!toDelete} danger title="Delete this draft?" confirmLabel="Delete" cancelLabel="Keep it"
        onConfirm={deleteDraft} onCancel={() => setToDelete(null)}>
        “{toDelete?.form.title?.trim() || 'Untitled'}” will be deleted from all your devices. This can’t be undone.
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
