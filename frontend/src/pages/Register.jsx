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
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setError(''); setFields((f) => ({ ...f, [k]: '' })); setForm({ ...form, [k]: e.target.value }) }

  const submit = async (e) => {
    e.preventDefault()
    const bad = check(form, { first_name: rules.required('your first name'), last_name: rules.required('your last name'), email: rules.email, password: rules.newPassword })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { first_name: 'reg-first', last_name: 'reg-last', email: 'reg-email', password: 'reg-password' }); return }
    setError('')
    setBusy(true)
    try {
      const r = await register(form)
      navigate('/verify-email', { state: { email: r.email, demo_code: r.demo_code, email_sent: r.email_sent, email_problem: r.email_problem } })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <AuthShell title="Create your account"
      footer={<>Already have an account? <Link className="whitespace-nowrap font-medium text-bark-500 hover:underline" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorSlot error={error} />
        <div className="grid grid-cols-2 gap-3">
          <IconInput id="reg-first" icon={UserIcon} required autoComplete="given-name" placeholder="First name" aria-label="First name" value={form.first_name} onChange={set('first_name')} error={fields.first_name} />
          <input id="reg-last" className={`input self-start ${fields.last_name ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} required autoComplete="family-name" placeholder="Last name" aria-label="Last name" aria-invalid={!!fields.last_name} value={form.last_name} onChange={set('last_name')} />
        </div>
        {fields.last_name && !fields.first_name && <p className="-mt-2 text-xs text-rose-600" role="alert">{fields.last_name}</p>}
        <IconInput id="reg-email" icon={MailIcon} type="email" required autoComplete="email" placeholder="Email address" aria-label="Email address" value={form.email} onChange={set('email')} error={fields.email} />
        <PasswordInput id="reg-password" icon={LockIcon} required minLength={8} autoComplete="new-password" placeholder="Password" aria-label="Password" value={form.password} onChange={set('password')}
          error={fields.password} hint="8+ characters, letters and numbers" />
        <button className="btn-primary btn-lg w-full" disabled={busy}>{busy ? <><Spinner /> Creating your account…</> : 'Create my account'}</button>
      </form>
    </AuthShell>
  )
}
