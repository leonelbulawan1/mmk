import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Card, Empty, Field, PageHeader, Spinner, Tag, useAsync } from '../components/ui'

// In the browser edition links cannot open a specific page, so only the code is shown there.
const WEB = import.meta.env.VITE_WEB_RUNTIME === '1'

const blank = { display_name: '', email: '', handle: '' }

// Pydantic's own wording for a malformed address is long; say it plainly.
const plainEmailError = (msg) => /not a valid email address/i.test(msg || '') ? 'Enter a valid email address, like maria.santos@gmail.com.' : msg

function InviteStatus({ inv }) {
  if (!inv) return null
  if (inv.status === 'bounced') return <Tag tone="bark">Email doesn't exist</Tag>
  if (inv.status === 'delivered') return <Tag>Invite delivered</Tag>
  if (inv.status === 'sent') return <Tag>Invite sent</Tag>
  if (inv.status === 'failed') return <Tag tone="bark">Invite not sent</Tag>
  return null
}

function FixEmail({ b, onSaved }) {
  const [email, setEmail] = useState(b.email)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { onSaved(b, await api(`/api/beneficiaries/${b.id}`, { method: 'PATCH', body: { email } })) }
    catch (ex) { setErr(plainEmailError(ex.message)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="mt-3 rounded-xl border border-rose-600/30 bg-rose-100 p-3 text-sm">
      <p className="text-rose-600">The invitation to <b>{b.email}</b> bounced. This email address doesn't exist or can't receive mail. Correct it and we'll send a new invitation.</p>
      <div className="mt-2 flex gap-2">
        <input className="input py-1.5 text-sm" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy || email.trim().toLowerCase() === b.email}>{busy ? 'Sending…' : 'Save and resend'}</button>
      </div>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </form>
  )
}

export default function Beneficiaries() {
  const { user } = useAuth()
  const sealed = !!user.death_triggered_at
  const list = useAsync(() => api('/api/beneficiaries'))
  const [form, setForm] = useState(blank)
  const [invite, setInvite] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [emailError, setEmailError] = useState('')
  const set = (k) => (e) => {
    const v = e.target.value
    if (k === 'email') setEmailError('')
    setForm((f) => ({ ...f, [k]: v, ...(k === 'display_name' && !f._handleTouched ? { handle: v.split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') } : {}), ...(k === 'handle' ? { _handleTouched: true } : {}) }))
  }

  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setEmailError('')
    try {
      const { _handleTouched, ...body } = form
      const res = await api('/api/beneficiaries', { method: 'POST', body })
      setInvite({ name: res.beneficiary.display_name, email: res.beneficiary.email, code: res.invite_code, link: res.invite_link, emailed: res.invitation?.status === 'sent' })
      setForm(blank); list.reload()
    } catch (err) {
      const msg = plainEmailError(err.message)
      if (/email/i.test(msg)) setEmailError(msg); else setError(msg)
    } finally { setBusy(false) }
  }

  const reissue = async (b) => {
    try {
      const res = await api(`/api/beneficiaries/${b.id}/invite`, { method: 'POST' })
      setInvite({ name: b.display_name, email: b.email, code: res.invite_code, link: res.invite_link, emailed: res.invitation?.status === 'sent' })
    } catch (err) { setError(err.message) }
  }
  const emailFixed = (b, res) => {
    setInvite({ name: b.display_name, email: res.email, code: res.invite_code, link: res.invite_link, emailed: res.invitation?.status === 'sent' })
    list.reload()
  }
  const toggle = async (b) => {
    try { await api(`/api/beneficiaries/${b.id}`, { method: 'PATCH', body: { active: !b.active } }); list.reload() }
    catch (err) { setError(err.message) }
  }

  return (
    <>
      <PageHeader eyebrow="the people you trust" title="Beneficiaries"
        subtitle="Register the people who may remember you through your diary. They see nothing while you are alive; after your passing, only what your legacy policy allows." />
      <div className="mb-4 space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        {invite && (invite.emailed ? (
          <Alert kind="success" onClose={() => setInvite(null)}>
            Invitation sent to <b>{invite.email}</b>. {invite.name} can activate their account from the link in the email.
            <span className="mt-1 block text-xs">Not in their inbox? Ask them to check Spam, or send them the link yourself (it works once).</span>
            {invite.link && !WEB && (
              <button type="button" className="btn-secondary mt-2 px-2.5 py-1 text-xs"
                onClick={() => navigator.clipboard?.writeText(invite.link).catch(() => {})}>Copy invite link</button>
            )}
          </Alert>
        ) : (
          <Alert kind="warn" onClose={() => setInvite(null)}>
            We couldn't email the invitation to <b>{invite.email}</b>. Send {invite.name} this code yourself:
            <code className="mx-1 rounded bg-white/70 px-2 py-0.5 font-mono text-base">{invite.code}</code>
            It works once and is shown only now. They enter it at <b>/activate</b>.
            {invite.link && !WEB && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span>Or send this link:</span>
                <code className="max-w-full truncate rounded bg-white/70 px-2 py-0.5 text-xs">{invite.link}</code>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => navigator.clipboard?.writeText(invite.link).catch(() => {})}>Copy link</button>
              </div>
            )}
          </Alert>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {list.loading ? <Spinner /> : !list.data?.length ? (
            <Empty title="No beneficiaries yet">Add someone on the right, then write a policy for them.</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {list.data.map((b) => (
                <Card key={b.id} className={b.active ? '' : 'opacity-60'}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-2xl font-semibold">{b.display_name}</h3>
                      <p className="break-all text-sm text-ink-400">{b.email}</p>
                    </div>
                    <Tag tone="ink">{b.handle}</Tag>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Tag>{b.activated ? 'Account active' : 'Invite pending'}</Tag>
                    {!b.activated && <InviteStatus inv={b.invitation} />}
                    {!b.active && <Tag tone="bark">Deactivated</Tag>}
                    {user.executor?.id === b.id && <Tag tone="ink">Executor</Tag>}
                    <Tag>Added {fmtDate(b.created_at)}</Tag>
                  </div>
                  {!sealed && !b.activated && b.invitation?.status === 'bounced' && <FixEmail key={b.email} b={b} onSaved={emailFixed} />}
                  <div className="mt-4 flex flex-wrap gap-2">
                  {!sealed && (
                    <>
                      {!b.activated && <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => reissue(b)}>Send invite again</button>}
                      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => toggle(b)}>{b.active ? 'Deactivate' : 'Reactivate'}</button>
                      <Link className="btn-ghost px-3 py-1.5 text-xs" to={`/assistant?as=${b.handle}`}>Preview as {b.display_name.split(' ')[0]}</Link>
                    </>
                  )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {!sealed && (
          <Card>
            <h2 className="text-2xl font-semibold">Register someone</h2>
            <form onSubmit={create} className="mt-4 space-y-4">
              <Field label="Full name"><input className="input" required value={form.display_name} onChange={set('display_name')} /></Field>
              <Field label="Email" hint="Any email works: Gmail, Yahoo, Outlook, school or work.">
                <input className={`input ${emailError ? 'border-rose-600' : ''}`} type="email" required value={form.email} onChange={set('email')} aria-invalid={!!emailError} />
                {emailError && <p className="mt-1 text-xs text-rose-600">{emailError}</p>}</Field>
              <Field label="Policy handle" hint="Used in your policy, e.g. allow maria …  (lowercase)">
                <input className="input font-mono" required pattern="[a-z][a-z0-9_]{1,31}" value={form.handle} onChange={set('handle')} /></Field>
              <button className="btn-primary w-full" disabled={busy}>{busy ? 'Adding…' : 'Add and create invite'}</button>
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
