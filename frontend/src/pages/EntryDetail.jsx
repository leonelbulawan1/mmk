import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import WhoCanRead from '../components/WhoCanRead'
import DiffView from '../components/DiffView'
import { Alert, Card, Hash, PageHeader, Spinner, Tag, useAsync, useToast } from '../components/ui'
import NavIcon from '../components/NavIcon'

const MODE_LABEL = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

function savedText(d) {
  if (!d) return 'Entry saved.'
  if (d.status === 'delivered') {
    if (d.email === 'sent') return `Letter sent. We emailed ${d.to}, and the letter is on their MMK home page.`
    if (d.email === 'failed') return `The letter is on their MMK home page, but we couldn't send the email. ${d.email_problem || ''}`
    return 'Letter sent to their MMK home page.'
  }
  if (d.after_death) return d.days_after_death ? `Letter saved. It opens ${d.days_after_death} days after your passing.` : 'Letter saved. It opens after your passing.'
  return `Letter saved. It will be delivered on ${fmtDate(d.opens_on)}.`
}

export default function EntryDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const { data: e, error, loading, setData } = useAsync(() => api(`/api/entries/${id}`), [id])
  const [view, setView] = useState('current')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const failedEmail = location.state?.delivery?.email === 'failed'
  const [msg, setMsg] = useState({ kind: 'warn', text: location.state?.justCreated && failedEmail ? savedText(location.state.delivery) : '' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  useEffect(() => { if (location.state?.justCreated && !failedEmail) toast(savedText(location.state.delivery)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sealed = !!user.death_triggered_at
  // "Add revision" from the ⋮ menu in All entries opens the revision form straight away.
  useEffect(() => {
    if (e && location.state?.revise && !sealed && e.kind !== 'letter') { setDraft(e.current_text); setEditing(true) }
  }, [e?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner label="Loading entry" />
  if (error) return <Alert>{error}</Alert>

  const revise = async (text, source) => {
    setBusy(true)
    try {
      setData(await api(`/api/entries/${id}/revisions`, { method: 'POST', body: { text, source } }))
      setEditing(false); setMsg({}); toast('Changes saved. Your original words are kept under Original.')
    } catch (err) { setMsg({ kind: 'error', text: err.message }) } finally { setBusy(false) }
  }
  const acceptReview = () => revise(e.review.suggestions.map((op) => (op.op === 'equal' ? op.before : op.after)).join(''), 'review')

  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2">
          <Link to={e.kind === 'letter' ? '/entries?kind=letter' : '/entries?kind=text'} className="font-medium text-bark-500 hover:underline">{e.kind === 'letter' ? 'Letters' : 'Diary entries'}</Link>
          <span aria-hidden>/</span><span>{fmtDate(e.entry_date)}</span>
        </nav>}
        title={e.title || 'Untitled'}
        actions={<>
          <Link to="/entries" className="btn-ghost">← All entries</Link>
          {!sealed && !editing && e.kind !== 'letter' && <button className="btn-primary" onClick={() => { setDraft(e.current_text); setEditing(true); setView('current') }}><NavIcon name="edit" size={16} />Edit</button>}
        </>} />
      {msg.text && <div className="mb-4"><Alert kind={msg.kind || 'success'} onClose={() => setMsg({})}>{msg.text}</Alert></div>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {e.pending_review && e.review && (
            <Card className="border-gold-500/40">
              <h2 className="text-lg font-semibold">Suggestions to review</h2>
              <p className="mb-4 text-sm text-ink-400">Accepting adds a revision; your original words stay in the vault.</p>
              <div className="rounded-xl bg-cream-100 p-4"><DiffView ops={e.review.suggestions} /></div>
              {!sealed && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={busy} onClick={acceptReview}>Accept suggestions</button>
                  <button className="btn-secondary" disabled={busy} onClick={() => { setDraft(e.review.suggestions.map((op) => (op.op === 'equal' ? op.before : op.after)).join('')); setEditing(true) }}>Edit before accepting</button>
                </div>
              )}
            </Card>
          )}

          {/* The message itself: a bar (versions, when and how it was written), the text, then its themes. */}
          <article className="card flex flex-col overflow-hidden p-0 lg:min-h-[calc(100vh-13rem)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-300 px-5 py-3 sm:px-6">
              {e.revision_history.length > 0 && !editing ? (
                <div className="inline-flex h-[42px] rounded-xl border border-cream-300 bg-cream-100 p-1 text-sm font-medium" role="tablist">
                  {[['current', 'Current text'], ['original', 'Original'], ['history', `Revisions (${e.revision_history.length})`]].map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                      className={`rounded-lg px-3 transition ${view === k ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200'}`}>{l}</button>
                  ))}
                </div>
              ) : <p className="text-sm font-medium text-ink-500">{editing ? 'Editing' : 'Exactly as first written'}</p>}
              <p className="text-xs text-ink-400">
                {new Date(e.created_at).toLocaleString(undefined, { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {e.kind === 'letter' ? '' : ` · ${MODE_LABEL[e.writing_mode]}`}
              </p>
            </div>

            <div className="flex-1 px-5 py-5 sm:px-8 sm:py-6">
              {editing ? (
                <div>
                  <textarea className="input paper-lines min-h-[50vh] text-lg" value={draft} onChange={(ev) => setDraft(ev.target.value)} aria-label="Edit entry text" autoFocus />
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                    <button className="btn-primary" disabled={busy || !draft.trim()} onClick={() => revise(draft, e.pending_review ? 'review' : 'edit')}>{busy ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              ) : view === 'history' ? (
                <ol className="space-y-5">
                  {e.revision_history.map((r, i) => (
                    <li key={r.id} className="border-l-2 border-gold-400 pl-4">
                      <p className="text-xs text-ink-400">Revision {i + 1} · {r.source.replace('_', ' ')} · {fmtDate(r.created_at)} · seq {r.seq} · <Hash value={r.hash} /></p>
                      <div className="mt-2"><DiffView ops={r.diff} /></div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="paper-lines max-w-3xl whitespace-pre-wrap text-lg text-ink-600">{view === 'original' ? e.original_text : e.current_text}</p>
              )}
            </div>

            {(e.topics.length > 0 || e.names.length > 0) && !editing && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-cream-300 bg-cream-100/60 px-5 py-3 text-xs sm:px-6">
                {e.topics.length > 0 && <span className="flex flex-wrap items-center gap-1.5"><span className="text-ink-400">Themes</span>{e.topics.map((t) => <Tag key={t} tone="bark">{t}</Tag>)}</span>}
                {e.names.length > 0 && <span className="flex flex-wrap items-center gap-1.5"><span className="text-ink-400">People</span>{e.names.map((n) => <Tag key={n}>{n}</Tag>)}</span>}
              </div>
            )}
          </article>
        </div>

        {/* One side panel: details, who can read it, and its seal. */}
        <aside className="card divide-y divide-cream-300 p-0 lg:sticky lg:top-6">
          <dl className="space-y-2.5 px-5 py-4 text-sm">
            {(e.kind === 'letter' ? [
              ['To', <b key="to" className="font-semibold">{e.recipient_name || e.recipient}</b>],
              ['Delivery', e.release_on_death ? (e.release_days_after_death ? `${e.release_days_after_death} days after your passing` : 'After your passing')
                : e.deliver_while_alive ? fmtDate(e.release_on) : <>{fmtDate(e.release_on)}, after your passing</>],
              ...(e.delivery ? [['Status', e.delivery.status === 'delivered'
                ? <>Delivered{e.delivery.email === 'sent' ? ', email sent' : e.delivery.email === 'failed' ? ', email failed' : ''}</>
                : e.delivery.after_death ? 'Waiting' : `Scheduled for ${fmtDate(e.delivery.opens_on)}`]] : []),
            ] : [
              ['Writing mode', MODE_LABEL[e.writing_mode]],
              ['Revisions', e.revision_history.length || 'None'],
            ]).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="text-right text-ink-700">{v}</dd></div>
            ))}
            <div className="pt-1"><dt className="text-ink-400">Summary <span className="text-xs">(what “summary” access shows)</span></dt><dd className="mt-1 italic text-ink-600">{e.summary}</dd></div>
          </dl>
          <div className="px-5 py-4"><WhoCanRead entryId={e.id} sealed={sealed} bare /></div>
          <div className="space-y-1.5 px-5 py-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-sage-600"><NavIcon name="access" size={16} />Sealed in your vault · record #{e.seq}</p>
            <details>
              <summary className="link cursor-pointer list-none text-xs">Technical details</summary>
              <div className="mt-2 space-y-1.5 rounded-xl bg-cream-100 p-3 text-xs">
                <p><span className="text-ink-400">Hash</span> <Hash value={e.hash} n={16} /></p>
                <p><span className="text-ink-400">Previous</span> <Hash value={e.prev_hash} n={16} /></p>
              </div>
            </details>
          </div>
        </aside>
      </div>
    </>
  )
}
