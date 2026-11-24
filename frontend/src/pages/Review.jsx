import { useState } from 'react'
import { api, fmtDate } from '../api'
import PasswordInput from '../components/PasswordInput'
import { Alert, Card, Dialog, Empty, Field, PageHeader, Spinner, useAsync } from '../components/ui'

// MMK reviewers decide on reports of an owner's passing. They see names, dates, documents and disputes only:
// never anything from the diary.
const LABEL = {
  reported: ['Needs review', 'bg-[#FBF0D9] text-bark-600'],
  under_review: ['Under review', 'bg-cream-200 text-ink-600'],
  verified: ['Verified · waiting period', 'bg-sage-100 text-sage-600'],
  disputed: ['Disputed', 'bg-rose-100 text-rose-600'],
  rejected: ['Rejected', 'bg-cream-200 text-ink-500'],
  cancelled: ['Cancelled by owner', 'bg-cream-200 text-ink-500'],
  withdrawn: ['Withdrawn', 'bg-cream-200 text-ink-500'],
  activated: ['Legacy active', 'bg-ink-700 text-cream-50'],
}
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')

function Pill({ status }) {
  const [label, cls] = LABEL[status] || [status, 'bg-cream-200 text-ink-500']
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function CaseView({ id, onChanged }) {
  const c = useAsync(() => api(`/api/review/cases/${id}`), [id])
  const [dialog, setDialog] = useState(null)   // 'approve' | 'reject'
  const [form, setForm] = useState({ note: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (c.loading) return <Spinner label="Loading report" />
  if (c.error) return <Alert>{c.error}</Alert>
  const d = c.data
  const act = async (step, body) => {
    setBusy(true); setError('')
    try { c.setData(await api(`/api/review/cases/${id}/${step}`, { method: 'POST', body })); setDialog(null); setForm({ note: '', password: '' }); onChanged() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const open = async (ev) => {
    try {
      const f = await api(`/api/review/evidence/${ev.id}`)
      const bytes = Uint8Array.from(atob(f.content_base64), (ch) => ch.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: f.content_type }))
      window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { setError(e.message) }
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{d.owner_name}</h2>
          <p className="text-sm text-ink-400">Reported by {d.reported_by} ({d.reported_by_relationship}) on {when(d.reported_at)}</p>
        </div>
        <Pill status={d.status} />
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {d.activates_at && d.status === 'verified' && <p className="mt-3 text-sm">The legacy becomes active on <b>{when(d.activates_at)}</b> unless the owner cancels or a beneficiary disputes.</p>}
      {d.dispute_reason && <div className="mt-3 rounded-xl bg-rose-100 p-3 text-sm text-rose-600"><b>Dispute from {d.disputed_by}:</b> {d.dispute_reason}</div>}
      {d.decision_note && <p className="mt-3 text-sm text-ink-500">Decision note: {d.decision_note}</p>}

      <h3 className="mt-5 font-semibold">Documents</h3>
      {d.evidence.length ? (
        <ul className="mt-2 space-y-2">{d.evidence.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cream-300 px-3 py-2 text-sm">
            <span>{ev.filename} <span className="text-xs text-ink-400">· {Math.ceil(ev.size / 1024)} KB · {fmtDate(ev.created_at)}</span></span>
            <button className="btn-secondary btn-sm" onClick={() => open(ev)}>Open</button>
          </li>))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-400">No documents yet. The executor is asked to upload one.</p>}
      <p className="mt-2 text-xs text-ink-400">Check the document yourself (name, date, issuing office). An uploaded file is not proof by itself.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {['reported', 'disputed'].includes(d.status) && <button className="btn-primary" disabled={busy} onClick={() => act('start')}>Start review</button>}
        {d.status === 'under_review' && <button className="btn-primary" disabled={busy || !d.evidence.length} onClick={() => setDialog('approve')}>Approve</button>}
        {['reported', 'under_review', 'disputed'].includes(d.status) && <button className="btn-ghost" disabled={busy} onClick={() => setDialog('reject')}>Reject</button>}
      </div>

      {d.history?.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">History</h3>
          <ol className="mt-2 space-y-1 text-xs text-ink-500">{d.history.map((h, i) => <li key={i}>{when(h.at)} · {h.action.replaceAll('_', ' ')} · {h.by}</li>)}</ol>
        </>
      )}

      <Dialog open={!!dialog} title={dialog === 'approve' ? 'Approve this report?' : 'Reject this report?'} onClose={busy ? undefined : () => setDialog(null)}
        footer={<>
          <button className="btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
          <button className={dialog === 'approve' ? 'btn-primary' : 'btn-danger'} disabled={busy || (dialog === 'approve' ? !form.password : !form.note.trim())}
            onClick={() => act(dialog, form)}>{busy ? 'Please wait…' : dialog === 'approve' ? 'Approve' : 'Reject'}</button>
        </>}>
        <div className="space-y-3 text-sm">
          {dialog === 'approve'
            ? <p>The waiting period starts now. When it ends, unless {d.owner_name} cancels or a beneficiary disputes, the vault is sealed and the legacy instructions take effect. That cannot be undone.</p>
            : <p>The report is closed and nothing is released. The executor can report again later.</p>}
          {error && <Alert>{error}</Alert>}
          <Field label={dialog === 'approve' ? 'Note (optional): what you checked' : 'Why is it rejected?'}>
            <textarea className="input min-h-20" maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          {dialog === 'approve' && <Field label="Your password"><PasswordInput autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
        </div>
      </Dialog>
    </Card>
  )
}

export default function Review() {
  const list = useAsync(() => api('/api/review/cases'))
  const [selected, setSelected] = useState(null)
  const open = (list.data || []).filter((c) => ['reported', 'under_review', 'disputed', 'verified'].includes(c.status))
  const closed = (list.data || []).filter((c) => !open.includes(c))
  const Row = ({ c }) => (
    <li>
      <button onClick={() => setSelected(c.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-cream-200 ${selected === c.id ? 'bg-cream-200' : ''}`}>
        <span><span className="font-medium">{c.owner_name}</span><span className="block text-xs text-ink-400">{when(c.reported_at)}</span></span>
        <Pill status={c.status} />
      </button>
    </li>
  )
  return (
    <>
      <PageHeader title="Review reports" />
      {list.loading ? <Spinner label="Loading reports" /> : list.error ? <Alert>{list.error}</Alert> : !list.data.length ? (
        <Empty title="No reports" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="h-fit p-3">
            <p className="px-3 pb-1 text-xs uppercase tracking-wider text-ink-400">Open</p>
            <ul>{open.map((c) => <Row key={c.id} c={c} />)}</ul>
            {closed.length > 0 && <><p className="px-3 pb-1 pt-3 text-xs uppercase tracking-wider text-ink-400">Closed</p><ul>{closed.map((c) => <Row key={c.id} c={c} />)}</ul></>}
          </Card>
          <div className="lg:col-span-2">
            {selected ? <CaseView key={selected} id={selected} onChanged={list.reload} /> : <Empty title="No report selected" />}
          </div>
        </div>
      )}
    </>
  )
}
