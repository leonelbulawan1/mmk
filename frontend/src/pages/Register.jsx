import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import PasswordInput from '../components/PasswordInput'
import { IconInput, LockIcon, MailIcon, UserIcon } from '../components/icons'
import { AuthShell, ErrorSlot, Spinner } from './Login'
import { check, focusFirst, rules } from '../validation'

// Create an account: diary owners only. Beneficiaries are registered by their owner and
// activate the account on the Activate page (see Activate.jsx).
export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ display_name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setError(''); setFields((f) => ({ ...f, [k]: '' })); setForm({ ...form, [k]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    const bad = check(form, { display_name: rules.required('your full name'), email: rules.email, password: rules.newPassword })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { display_name: 'reg-name', email: 'reg-email', password: 'reg-password' }); return }
    setError('')
    setBusy(true)
    try {
      const r = await register(form)
      navigate('/verify-email', { state: { email: r.email, demo_code: r.demo_code, email_sent: r.email_sent, email_problem: r.email_problem } })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <AuthShell title="Create your account" subtitle="Start your private diary."
      footer={<>Already have an account? <Link className="whitespace-nowrap font-medium text-bark-500 hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorSlot error={error} />
        <IconInput id="reg-name" icon={UserIcon} required autoComplete="name" placeholder="Full name" aria-label="Full name" value={form.display_name} onChange={set('display_name')} error={fields.display_name} />
        <IconInput id="reg-email" icon={MailIcon} type="email" required autoComplete="email" placeholder="Email address" aria-label="Email address" value={form.email} onChange={set('email')} error={fields.email} />
        <PasswordInput id="reg-password" icon={LockIcon} required minLength={8} autoComplete="new-password" placeholder="Password" aria-label="Password" value={form.password} onChange={set('password')}
          error={fields.password} hint="At least 8 characters, with letters and numbers." />
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><Spinner /> Creating your account…</> : 'Create my account'}</button>
      </form>
    </AuthShell>
  )
}
