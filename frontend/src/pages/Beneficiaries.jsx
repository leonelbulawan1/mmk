import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Empty, Field, PageHeader, Section, Spinner, Tag, useAsync, useToast, Dialog } from '../components/ui'
import { check, focusFirst, rules } from '../validation'
import NavIcon from '../components/NavIcon'

// In the browser edition links cannot open a specific page, so only the code is shown there.
const WEB = import.meta.env.VITE_WEB_RUNTIME === '1'

const blank = { display_name: '', email: '', handle: '' }

// Pydantic's own wording for a malformed address is long; say it plainly.
const plainEmailError = (msg) => /not a valid email address/i.test(msg || '') ? 'Enter a valid email address, like name@gmail.com.' : msg

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
        <button className="btn-primary btn-sm" disabled={busy || email.trim().toLowerCase() === b.email}>{busy ? 'Sending…' : 'Save and resend'}</button>
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
  const [fields, setFields] = useState({})
  const [adding, setAdding] = useState(false)
  const toast = useToast()
  const set = (k) => (e) => {
    const v = e.target.value
    setFields((f) => ({ ...f, [k]: '' }))
    if (k === 'email') setEmailError('')
    setForm((f) => ({ ...f, [k]: v, ...(k === 'display_name' && !f._handleTouched ? { handle: v.split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') } : {}), ...(k === 'handle' ? { _handleTouched: true } : {}) }))
  }

  const create = async (e) => {
    e.preventDefault()
    const bad = check(form, { display_name: rules.required('their full name'), email: rules.otherEmail, handle: rules.handle })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { display_name: 'ben-name', email: 'ben-email', handle: 'ben-handle' }); return }
    setBusy(true); setError(''); setEmailError('')
    try {
      const { _handleTouched, ...body } = form
      const res = await api('/api/beneficiaries', { method: 'POST', body })
      setInvite({ name: res.beneficiary.display_name, email: res.beneficiary.email, code: res.invite_code, link: res.invite_link, emailed: res.invitation?.status === 'sent' })
      setForm(blank); setAdding(false); list.reload()
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
    try { await api(`/api/beneficiaries/${b.id}`, { method: 'PATCH', body: { active: !b.active } }); list.reload(); toast(b.active ? `${b.display_name} was deactivated.` : `${b.display_name} was reactivated.`) }
    catch (err) { setError(err.message) }
  }

  return (
    <>
      <PageHeader title="Beneficiaries"
        meta={list.data?.length ? <Tag>{list.data.length}</Tag> : null}
        actions={!sealed && <button type="button" className="btn-primary" onClick={() => setAdding(true)}><NavIcon name="people" size={16} />Add beneficiary</button>} />
      <div className="mb-4 space-y-3">
        {!adding && <Alert onClose={() => setError('')}>{error}</Alert>}
        {invite && (invite.emailed ? (
          <Alert kind="success" onClose={() => setInvite(null)}>
            Invitation sent to <b>{invite.email}</b>. {invite.name} can activate their account from the link in the email.
            {invite.link && !WEB && (
              <button type="button" className="btn-secondary btn-sm mt-2"
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
                <button type="button" className="btn-secondary btn-sm"
                  onClick={() => navigator.clipboard?.writeText(invite.link).catch(() => {})}>Copy link</button>
              </div>
            )}
          </Alert>
        ))}
      </div>

      <div>
        <Section className="min-w-0" title="Your beneficiaries" bodyClassName="p-0">
          {list.loading ? <div className="px-6"><Spinner label="Loading beneficiaries" /></div> : !list.data?.length ? (
            <div className="p-6"><Empty title="No beneficiaries yet" action={!sealed && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add beneficiary</button>} /></div>
          ) : (
            <ul className="divide-y divide-cream-200">
              {list.data.map((b) => (
                <li key={b.id} className={`px-5 py-4 sm:px-6 ${b.active ? '' : 'opacity-60'}`}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream-200 text-base font-semibold text-ink-600">
                      {b.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{b.display_name}</h3>
                        <code className="rounded bg-cream-200 px-1.5 py-0.5 text-xs text-ink-500">{b.handle}</code>
                        {user.executor?.id === b.id && <Tag tone="ink">Executor</Tag>}
                      </div>
                      <p className="break-all text-sm text-ink-400">{b.email}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Tag tone={b.activated ? 'cream' : 'bark'}>{b.activated ? 'Account active' : 'Invite pending'}</Tag>
                        {!b.activated && <InviteStatus inv={b.invitation} />}
                        {!b.active && <Tag tone="bark">Deactivated</Tag>}
                        <span className="self-center text-ink-400">Added {fmtDate(b.created_at)}</span>
                      </div>
                    </div>
                    {!sealed && (
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                        <Link className="btn-secondary btn-sm" to={`/assistant?as=${b.handle}`}>Preview as {b.display_name.split(' ')[0]}</Link>
                        {!b.activated && <button className="btn-secondary btn-sm" onClick={() => reissue(b)}>Send invite again</button>}
                        <button className="btn-ghost btn-sm" onClick={() => toggle(b)}>{b.active ? 'Deactivate' : 'Reactivate'}</button>
                      </div>
                    )}
                  </div>
                  {!sealed && !b.activated && b.invitation?.status === 'bounced' && <FixEmail key={b.email} b={b} onSaved={emailFixed} />}
                </li>
              ))}
            </ul>
          )}
        </Section>

      </div>
      <Dialog open={adding} size="xl" icon={<NavIcon name="people" size={18} />} title="Add beneficiary"
        onClose={busy ? undefined : () => { setAdding(false); setFields({}); setEmailError('') }}>
        {/* Same card as the writing window: fields on top, actions in a bar at the bottom. */}
        <form id="add-beneficiary" onSubmit={create} noValidate className="card flex flex-col overflow-hidden p-0 sm:min-h-[calc(40vh+231px)]">
          <div className="flex-1 space-y-5 px-5 py-6 sm:px-6">
            <Alert onClose={() => setError('')}>{error}</Alert>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Full name" error={fields.display_name}><input id="ben-name" data-autofocus className={`input ${fields.display_name ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} required aria-invalid={!!fields.display_name} value={form.display_name} onChange={set('display_name')} /></Field>
              <Field label="Email" error={fields.email || emailError}>
                <input id="ben-email" className={`input ${fields.email || emailError ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} type="email" required value={form.email} onChange={set('email')} aria-invalid={!!(fields.email || emailError)} /></Field>
            </div>
            <div className="sm:w-1/2 sm:pr-2.5">
              <Field label="Policy handle" error={fields.handle}>
                <input id="ben-handle" className={`input font-mono ${fields.handle ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} required placeholder="maria" aria-invalid={!!fields.handle} value={form.handle} onChange={set('handle')} /></Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-cream-300 bg-cream-100/70 px-4 py-3 sm:px-5">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setAdding(false); setFields({}); setEmailError('') }}>Cancel</button>
            <button type="submit" className="btn-primary px-5" disabled={busy}><NavIcon name="send" size={16} />{busy ? 'Sending invite…' : 'Add and send invite'}</button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
