import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import PasswordInput from '../components/PasswordInput'
import { IconInput, KeyIcon, LockIcon, MailIcon } from '../components/icons'
import { Alert } from '../components/ui'
import { AuthShell, ErrorSlot, Spinner } from './Login'
import { check, focusFirst, rules } from '../validation'

const RESEND_SECONDS = 60

// Forgot password, in two steps: (1) email -> a 6-digit code is emailed; (2) code + new password.
// The first step answers the same way whether or not the email has an account.
export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [demoCode, setDemoCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const [fields, setFields] = useState({})

  useEffect(() => { if (wait > 0) { const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t) } }, [wait])

  const sendCode = async (again = false) => {
    setBusy(true); setError(''); setInfo('')
    try {
      const r = await api('/api/auth/forgot-password', { method: 'POST', body: { email } })
      setDemoCode(r.demo_code || (again ? demoCode : ''))
      setStep('code'); setWait(RESEND_SECONDS); setCode('')
      if (again) setInfo('If an account exists for this email, we sent a new code.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const reset = async (e) => {
    e.preventDefault()
    const bad = check({ code, password }, { code: rules.code6, password: rules.newPassword })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { code: 'fp-code', password: 'fp-password' }); return }
    setBusy(true); setError(''); setInfo('')
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { email, code, new_password: password } })
      navigate('/login', { state: { email, reset: true } })
    } catch (err) { setError(err.message); setCode('') } finally { setBusy(false) }
  }

  if (step === 'email') {
    return (
      <AuthShell title="Forgot your password?" subtitle="Enter your email and we'll send you a code to reset it."
        footer={<>Remembered it? <Link className="whitespace-nowrap font-medium text-bark-500 hover:underline" to="/login">Sign in</Link></>}>
        <form noValidate onSubmit={(e) => { e.preventDefault(); const bad = check({ email }, { email: rules.email }); setFields(bad); if (bad.email) { focusFirst(bad, { email: 'fp-email' }); return } sendCode() }} className="space-y-4">
          <ErrorSlot error={error} />
          <IconInput id="fp-email" icon={MailIcon} type="email" required autoComplete="email" placeholder="Email address" aria-label="Email address"
            value={email} onChange={(e) => { setError(''); setFields({}); setEmail(e.target.value) }} error={fields.email} />
          <button className="btn-primary w-full py-3" disabled={busy}>{busy ? <><Spinner /> Sending code…</> : 'Send code'}</button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password"
      subtitle={<>If an account exists for <b className="font-medium text-ink-600">{email}</b>, we sent it a 6-digit code.</>}
      footer={<>Didn't get the code?{' '}
        {wait > 0 ? <span className="whitespace-nowrap">Resend in {wait}s</span>
          : <button type="button" onClick={() => sendCode(true)} className="whitespace-nowrap font-medium text-bark-500 hover:underline">Resend code</button>}
      </>}>
      <form onSubmit={reset} noValidate className="space-y-4">
        <ErrorSlot error={error}>
          {info ? <Alert kind="success">{info}</Alert>
            : demoCode ? <Alert kind="info">Demo: email can't be sent here, so your code is <b className="font-mono tracking-widest">{demoCode}</b>.</Alert> : null}
        </ErrorSlot>
        <IconInput id="fp-code" error={fields.code} icon={KeyIcon} required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          className="font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal"
          placeholder="6-digit code" aria-label="6-digit code" value={code}
          onChange={(e) => { setError(''); setFields((f) => ({ ...f, code: '' })); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)) }} />
        <PasswordInput id="fp-password" icon={LockIcon} required minLength={8} autoComplete="new-password" placeholder="New password" aria-label="New password"
          value={password} onChange={(e) => { setError(''); setFields((f) => ({ ...f, password: '' })); setPassword(e.target.value) }}
          error={fields.password} hint="At least 8 characters, with letters and numbers." />
        <button className="btn-primary w-full py-3" disabled={busy}>{busy ? <><Spinner /> Resetting password…</> : 'Reset password'}</button>
        <p className="text-center text-sm text-ink-400">Wrong email? <button type="button" className="font-medium text-bark-500 hover:underline" onClick={() => { setStep('email'); setError(''); setInfo('') }}>Change it</button></p>
      </form>
    </AuthShell>
  )
}
