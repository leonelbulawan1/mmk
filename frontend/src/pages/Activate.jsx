import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import PasswordInput from '../components/PasswordInput'
import { IconInput, KeyIcon, LockIcon, MailIcon } from '../components/icons'
import { AuthShell, ErrorSlot, Spinner } from './Login'
import { check, focusFirst, rules } from '../validation'

// Beneficiaries activate the account their diary owner created for them.
// Opened from the link in the invite or email (?email=…&code=…) everything but the password is
// already filled in; opened from "I received an invitation" on the home page they type the code themselves.
export default function Activate() {
  const [params] = useSearchParams()
  const { activate } = useAuth()
  const navigate = useNavigate()
  const fromLink = !!(params.get('email') && params.get('code'))
  const [form, setForm] = useState({ email: params.get('email') || '', invite_code: params.get('code') || '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fields, setFields] = useState({})
  const set = (k) => (e) => { setError(''); setFields((f) => ({ ...f, [k]: '' })); setForm({ ...form, [k]: e.target.value }) }

  // Keep the one-time code out of the address bar and browser history once it has been read.
  useEffect(() => {
    if (fromLink) try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
  }, [fromLink])

  const submit = async (e) => {
    e.preventDefault()
    const bad = check(form, { email: rules.email, invite_code: rules.required('your invite code'), password: rules.newPassword })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { email: 'act-email', invite_code: 'act-code', password: 'act-password' }); return }
    setError(''); setBusy(true)
    try { await activate(form); navigate('/home') }
    catch (err) { setError(fromLink ? 'This invite link has expired or was already used.' : err.message) }
    finally { setBusy(false) }
  }

  return (
    <AuthShell title="Activate your account"
      footer={<>Already activated? <Link className="whitespace-nowrap font-medium text-bark-500 hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorSlot error={error} />
        <IconInput id="act-email" error={fields.email} icon={MailIcon} type="email" required autoComplete="email" placeholder="Email address" aria-label="Email address"
          value={form.email} onChange={set('email')} readOnly={fromLink} className={fromLink ? 'bg-cream-100 text-ink-500' : ''} />
        {!fromLink && (
          <IconInput id="act-code" error={fields.invite_code} icon={KeyIcon} className="font-mono uppercase placeholder:font-sans placeholder:normal-case" required autoComplete="one-time-code"
            placeholder="Invite code" aria-label="Invite code" value={form.invite_code} onChange={set('invite_code')} />
        )}
        <PasswordInput id="act-password" icon={LockIcon} required minLength={8} autoComplete="new-password" placeholder="Create a password" aria-label="Create a password"
          value={form.password} onChange={set('password')} error={fields.password} hint="8+ characters, letters and numbers" />
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><Spinner /> Activating your account…</> : 'Activate my account'}</button>
      </form>
    </AuthShell>
  )
}
