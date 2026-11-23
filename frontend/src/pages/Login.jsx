import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Logo } from '../components/Layout'
import PasswordInput from '../components/PasswordInput'
import { IconInput, LockIcon, MailIcon } from '../components/icons'
import { Alert } from '../components/ui'
import { check, focusFirst, rules } from '../validation'

// Equal space above and below the card so it sits in the middle of the screen. The browser demo
// keeps a little more on both sides for its "Demo · accounts" button.
const WEB = import.meta.env.VITE_WEB_RUNTIME === '1'

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className={`flex min-h-[100dvh] items-center justify-center px-4 sm:py-10 ${WEB ? 'py-14' : 'py-4'}`}>
        {/* Same size for sign in, create account and forgot password: header on top, footer at the
            bottom, the form centred in between. */}
        <div className={`card flex w-full max-w-[400px] flex-col px-5 py-6 fade-in sm:p-8 [@media(max-height:620px)]:p-5 ${WEB ? 'min-h-[min(600px,calc(100dvh-7rem))]' : 'min-h-[min(600px,calc(100dvh-2rem))]'}`} data-auth-card>
          <header className="text-center">
            <Logo className="justify-center" />
            <h1 className="mt-6 text-2xl font-semibold [@media(max-height:620px)]:mt-3 [@media(max-height:620px)]:text-xl">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-400">{subtitle}</p>}
          </header>
          <div className="flex flex-1 flex-col justify-center py-6 sm:py-7 [@media(max-height:620px)]:py-4">{children}</div>
          {footer && <div className="border-t border-cream-300 pt-5 text-center text-sm text-ink-400 [@media(max-height:620px)]:pt-3">{footer}</div>}
        </div>
    </div>
  )
}

// The form's error message, in the normal flow at the top of the form (no space is reserved
// when there is no error, so the form sits where it always has).
export function ErrorSlot({ error, children }) {
  if (error) return <Alert>{error}</Alert>
  return children || null
}

export function Spinner() {
  return <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-cream-50/40 border-t-cream-50" />
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: location.state?.email || '', password: '', remember: false })
  const [error, setError] = useState('')
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const bad = check(form, { email: rules.email, password: rules.password })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { email: 'login-email', password: 'login-password' }); return }
    setBusy(true); setError('')
    try {
      const user = await login(form.email, form.password, form.remember)
      navigate(user.role === 'owner' ? '/dashboard' : '/home')
    } catch (err) {
      if (err.status === 403 && err.detail?.verify) {
        navigate('/verify-email', { state: { email: form.email, resend: true } })
        return
      }
      setError(err.message)
      // Clear the password and put the cursor back there, ready to try again.
      setForm((f) => ({ ...f, password: '' }))
      setTimeout(() => document.getElementById('login-password')?.focus(), 0)
    } finally { setBusy(false) }
  }
  // The message goes away as soon as the person starts typing again.
  const set = (k) => (e) => { setError(''); setFields((f) => ({ ...f, [k]: '' })); setForm({ ...form, [k]: e.target.value }) }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to your account."
      footer={<>Don't have an account? <Link className="whitespace-nowrap font-medium text-bark-500 hover:underline" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorSlot error={error}>
          {location.state?.reset && <Alert kind="success">Password changed. Sign in with your new password.</Alert>}
        </ErrorSlot>
        <IconInput id="login-email" icon={MailIcon} type="email" autoComplete="email" required placeholder="Email address" aria-label="Email address"
          value={form.email} onChange={set('email')} error={fields.email} />
        <PasswordInput id="login-password" icon={LockIcon} autoComplete="current-password" required placeholder="Password"
          aria-label="Password" value={form.password} onChange={set('password')} error={fields.password} />
        <div className="flex items-center justify-between gap-3 whitespace-nowrap text-sm [@media(max-width:340px)]:text-[13px]">
          <label className="flex cursor-pointer items-center gap-2 text-ink-500">
            <input type="checkbox" className="checkbox" checked={form.remember}
              onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
            Keep me signed in
          </label>
          <Link to="/forgot-password" className="font-medium text-bark-500 hover:underline">Forgot password?</Link>
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? <><Spinner /> Signing in…</> : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}
