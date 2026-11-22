import { useEffect, useState } from 'react'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import PasswordInput from './PasswordInput'
import { Alert, Card, Field, useAsync } from './ui'

const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
const waitText = (m) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`)

function useCountdown(iso) {
  const { refresh } = useAuth()
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  useEffect(() => setNow(Date.now()), [iso])
  const due = !!iso && new Date(iso).getTime() <= now
  // When the waiting period is over, ask the server again: it activates the trigger on that request.
  useEffect(() => { if (due) { const t = setInterval(refresh, 8000); refresh(); return () => clearInterval(t) } }, [due, refresh])
  if (!iso) return ''
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'any moment now'
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `in about ${hours} hour${hours === 1 ? '' : 's'}`
  return `in ${Math.round(hours / 24)} days`
}

// Owner: warning shown everywhere while an executor's report is waiting.
export function PendingReportBanner() {
  const { user, setUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rep = user?.role === 'owner' ? user.pending_report : null
  const left = useCountdown(rep?.activates_at)
  if (!rep) return null
  const cancel = async () => {
    setBusy(true); setError('')
    try { setUser(await api('/api/settings/death-report/cancel', { method: 'POST' })) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div role="alert" className="border-b border-rose-600/30 bg-rose-100 px-4 py-3 text-sm text-rose-600 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <p><b>{rep.reported_by}</b>, your executor, reported your passing on {fmtWhen(rep.reported_at)}. Your vault will be sealed and
          your beneficiaries notified {left} ({fmtWhen(rep.activates_at)}) unless you cancel.</p>
        <button className="btn-danger shrink-0" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : "I'm still here"}</button>
      </div>
      {error && <p className="mx-auto mt-2 max-w-6xl">{error}</p>}
    </div>
  )
}

// Owner: choose the executor (Settings).
export function ExecutorSettings() {
  const { user, setUser } = useAuth()
  const bens = useAsync(() => api('/api/beneficiaries'))
  const [choice, setChoice] = useState(user.executor?.id ? String(user.executor.id) : '')
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(false)
  const sealed = !!user.death_triggered_at
  const eligible = (bens.data || []).filter((b) => b.active && b.activated)

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg({})
    try {
      setUser(await api('/api/settings/executor', { method: 'PUT', body: { beneficiary_id: choice ? Number(choice) : null } }))
      setMsg({ kind: 'success', text: choice ? 'Executor saved.' : 'You no longer have an executor.' })
    } catch (err) { setMsg({ kind: 'error', text: err.message }) } finally { setBusy(false) }
  }

  return (
    <Card className="lg:col-span-2">
      <h2 className="text-2xl font-semibold">Executor</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-500">
        Choose a beneficiary you trust to report your passing. When they do, you are emailed and have a waiting period
        of {waitText(user.death_report_wait_minutes || 20160)} to press <b>“I'm still here”</b>. If nobody cancels, the death trigger
        activates on its own: your vault is sealed, your policy frozen, and your beneficiaries emailed. They never need your password.
      </p>
      {msg.text && <div className="mt-3"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>}
      {sealed ? (
        <p className="mt-3 text-sm">Executor: <b>{user.executor?.display_name || 'none'}</b> (the vault is sealed).</p>
      ) : (
        <form onSubmit={save} className="mt-4 grid gap-4 sm:max-w-xl sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Your executor" hint={eligible.length ? '' : 'Only beneficiaries who have activated their account can be chosen.'}>
            <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!!user.pending_report}>
              <option value="">No executor</option>
              {eligible.map((b) => <option key={b.id} value={b.id}>{b.display_name}{b.relationship ? ` (${b.relationship})` : ''}</option>)}
            </select>
          </Field>
          <button className="btn-secondary" disabled={busy || !!user.pending_report || choice === (user.executor?.id ? String(user.executor.id) : '')}>Save executor</button>
        </form>
      )}
    </Card>
  )
}

// Beneficiary who is the executor: report the owner's passing (Home).
export function ExecutorPanel() {
  const { user, setUser } = useAuth()
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const rep = user.report
  const left = useCountdown(rep?.activates_at)
  const phrase = user.confirm_phrase || 'REPORT PASSING'
  const ownerName = user.owner?.display_name || 'the diary owner'
  const first = ownerName.split(' ')[0]

  if (!user.is_executor || user.owner?.death_triggered) return null
  const call = async (path, body) => {
    setBusy(true); setError('')
    try { setUser(await api(path, { method: 'POST', body })); setForm({ password: '', confirmation: '' }) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Card className="mt-6 border-gold-500/40">
      <h2 className="text-2xl font-semibold">You are {first}'s executor</h2>
      {rep ? (
        <>
          <p className="mt-2 text-sm text-ink-500">
            You reported {first}'s passing on {fmtDate(rep.reported_at)}. {first} has been emailed. Unless {first} signs in and
            cancels it, the diary will be sealed and opened as {first} wished <b>{left}</b> ({fmtWhen(rep.activates_at)}).
          </p>
          {rep.wait_minutes < 60 && <p className="mt-2 text-xs text-ink-400">In this demo the waiting period is {waitText(rep.wait_minutes)} instead of 14 days.</p>}
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          <button className="btn-secondary mt-4" disabled={busy} onClick={() => call('/api/executor/withdraw')}>Withdraw my report</button>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-3xl text-sm text-ink-500">
            {ownerName} trusted you to tell MMK when they pass away. Only do this when it has happened. {first} will be emailed and
            can cancel it during a waiting period; after that, their diary is sealed and shared as they wished, and the other beneficiaries are emailed.
          </p>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          <form className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); call('/api/executor/report', form) }}>
            <Field label="Your password"><PasswordInput required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label={<>Type <b>{phrase}</b></>}><input className="input font-mono" required value={form.confirmation} onChange={(e) => setForm({ ...form, confirmation: e.target.value })} /></Field>
            <button className="btn-danger" disabled={busy || form.confirmation !== phrase}>{busy ? 'Reporting…' : `Report ${first}'s passing`}</button>
          </form>
        </>
      )}
    </Card>
  )
}
