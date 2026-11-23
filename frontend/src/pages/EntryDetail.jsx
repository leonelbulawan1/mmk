import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import WhoCanRead from '../components/WhoCanRead'
import DiffView from '../components/DiffView'
import { Alert, Card, Hash, LetterBadge, PageHeader, Spinner, Tag, useAsync, Section } from '../components/ui'
import NavIcon from '../components/NavIcon'

const MODE_LABEL = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

function savedText(d) {
  if (!d) return 'Saved.'
  if (d.status === 'delivered') {
    if (d.email === 'sent') return `Sent. An email went to ${d.to}, and the letter is on their MMK home page.`
    if (d.email === 'failed') return `Sent to their MMK home page, but the email could not be sent. ${d.email_problem || ''}`
    return 'Sent to their MMK home page.'
  }
  if (d.after_death) return d.days_after_death ? `Sent. This letter opens ${d.days_after_death} days after your death.` : 'Sent. This letter opens after your death.'
  return `Sent. It will be delivered on ${fmtDate(d.opens_on)}.`
}

export default function EntryDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const { data: e, error, loading, setData } = useAsync(() => api(`/api/entries/${id}`), [id])
  const [view, setView] = useState('current')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [msg, setMsg] = useState({ kind: location.state?.delivery?.email === 'failed' ? 'warn' : '', text: location.state?.justCreated ? savedText(location.state.delivery) : '' })
  const [busy, setBusy] = useState(false)
  const sealed = !!user.death_triggered_at
  // "Add revision" from the ⋮ menu in All entries opens the revision form straight away.
  useEffect(() => {
    if (e && location.state?.revise && !sealed) { setDraft(e.current_text); setEditing(true) }
  }, [e?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />
  if (error) return <Alert>{error}</Alert>

  const revise = async (text, source) => {
    setBusy(true)
    try {
      setData(await api(`/api/entries/${id}/revisions`, { method: 'POST', body: { text, source } }))
      setEditing(false); setMsg({ kind: 'success', text: 'Revision appended. The original is unchanged.' })
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
        meta={e.kind === 'letter' && <LetterBadge to={e.recipient_name || e.recipient} />}
        actions={<>
          <Link to="/entries" className="btn-ghost">← All entries</Link>
          {!sealed && !editing && <button className="btn-primary" onClick={() => { setDraft(e.current_text); setEditing(true); setView('current') }}><NavIcon name="edit" size={16} />Add a revision</button>}
        </>} />
      {msg.text && <div className="mb-4"><Alert kind={msg.kind || 'success'} onClose={() => setMsg({})}>{msg.text}</Alert></div>}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {e.pending_review && e.review && (
            <Card className="border-gold-500/40">
              <h2 className="text-xl font-semibold">Suggestions to review</h2>
              <p className="mb-4 text-sm text-ink-400">Accepting adds a revision; your original words stay in the vault.</p>
              <div className="rounded-xl bg-cream-100 p-4"><DiffView ops={e.review.suggestions} /></div>
              {!sealed && (
                <div className="mt-4 flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={acceptReview}>Accept suggestions</button>
                  <button className="btn-secondary" disabled={busy} onClick={() => { setDraft(e.review.suggestions.map((op) => (op.op === 'equal' ? op.before : op.after)).join('')); setEditing(true) }}>Edit before accepting</button>
                </div>
              )}
            </Card>
          )}

          <Card>
            {e.revision_history.length > 0 ? (
              <div className="mb-5 inline-flex rounded-xl border border-cream-300 bg-cream-100 p-1 text-sm font-medium" role="tablist">
                {[['current', 'Current text'], ['original', 'Original'], ['history', `Revisions (${e.revision_history.length})`]].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                    className={`rounded-lg px-3 py-1.5 transition ${view === k ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200'}`}>{l}</button>
                ))}
              </div>
            ) : <p className="mb-3 text-xs text-ink-400">Exactly as first written · no revisions</p>}
            {editing ? (
              <div>
                <textarea className="input paper-lines min-h-72 text-lg" value={draft} onChange={(ev) => setDraft(ev.target.value)} aria-label="Revision text" />
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary" disabled={busy || !draft.trim()} onClick={() => revise(draft, e.pending_review ? 'review' : 'edit')}>Append revision</button>
                  <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : view === 'history' ? (
              e.revision_history.length === 0 ? <p className="text-sm text-ink-400">No revisions. The text is exactly as first written.</p> : (
                <ol className="space-y-5">
                  {e.revision_history.map((r, i) => (
                    <li key={r.id} className="border-l-2 border-gold-400 pl-4">
                      <p className="text-xs text-ink-400">Revision {i + 1} · {r.source.replace('_', ' ')} · {fmtDate(r.created_at)} · seq {r.seq} · <Hash value={r.hash} /></p>
                      <div className="mt-2"><DiffView ops={r.diff} /></div>
                    </li>
                  ))}
                </ol>
              )
            ) : (
              <p className="paper-lines whitespace-pre-wrap text-lg text-ink-600">{view === 'original' ? e.original_text : e.current_text}</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Section title="Details" bodyClassName="p-0">
            <dl className="divide-y divide-cream-200 text-sm">
              {[
                ['Writing mode', MODE_LABEL[e.writing_mode]],
                ['Written', fmtDate(e.created_at)],
                ...(e.kind === 'letter' ? [
                  ['To', <b key="to">{e.recipient_name || e.recipient}</b>],
                  ['Opens', e.release_on_death ? <>{e.release_days_after_death ? `${e.release_days_after_death} days ` : ''}after your death{e.release_on ? ` (or on ${fmtDate(e.release_on)})` : ''}</>
                    : e.deliver_while_alive ? fmtDate(e.release_on) : <>{fmtDate(e.release_on)}, after your death</>],
                  ...(e.delivery ? [['Delivery', e.delivery.status === 'delivered'
                    ? <>On their home page{e.delivery.email === 'sent' ? ', email sent' : e.delivery.email === 'failed' ? ', but the email failed' : ''}</>
                    : e.delivery.after_death ? 'Waits for your death' : `On ${fmtDate(e.delivery.opens_on)}`]] : []),
                ] : []),
                ['Themes', e.topics.length ? <span className="flex flex-wrap justify-end gap-1.5">{e.topics.map((t) => <Tag key={t} tone="bark">{t}</Tag>)}</span> : '—'],
                ['People', e.names.length ? <span className="flex flex-wrap justify-end gap-1.5">{e.names.map((n) => <Tag key={n}>{n}</Tag>)}</span> : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-4 px-5 py-3"><dt className="shrink-0 text-ink-400">{k}</dt><dd className="text-right text-ink-700">{v}</dd></div>
              ))}
              <div className="px-5 py-3"><dt className="text-ink-400">Summary <span className="text-xs">(what “summary” access shows)</span></dt><dd className="mt-1 italic text-ink-600">{e.summary}</dd></div>
            </dl>
          </Section>
          <WhoCanRead entryId={e.id} sealed={sealed} />
          <Card className="space-y-2 text-sm">
            <h2 className="text-lg font-semibold">Integrity</h2>
            <p className="flex items-center gap-2 font-medium text-sage-600"><NavIcon name="access" size={18} />Sealed in your vault</p>
            <p className="text-ink-400">Record #{e.seq}{e.revision_history.length > 0 && <> · {e.revision_history.length} revision{e.revision_history.length > 1 ? 's' : ''} sealed after it</>}</p>
            <details className="group">
              <summary className="cursor-pointer list-none text-bark-500 hover:underline">Show technical details</summary>
              <div className="mt-2 space-y-1.5 rounded-xl bg-cream-100 p-3 text-xs">
                <p><span className="text-ink-400">Hash</span> <Hash value={e.hash} n={16} /></p>
                <p><span className="text-ink-400">Previous</span> <Hash value={e.prev_hash} n={16} /></p>
              </div>
            </details>
            <Link to="/vault" className="inline-block pt-1 text-bark-500 hover:underline">Verify the whole vault →</Link>
          </Card>
        </div>
      </div>
    </>
  )
}
