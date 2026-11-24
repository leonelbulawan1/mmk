import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { IconInput, KeyIcon, MailIcon } from '../components/icons'
import { Alert } from '../components/ui'
import { AuthShell, ErrorSlot, Spinner } from './Login'
import { check, focusFirst, rules } from '../validation'

const RESEND_SECONDS = 60

// Owners confirm their email with the 6-digit code sent at registration. The account cannot be
// used before this. Reached from Create an account, or from Sign in when the email is not verified.
export default function VerifyEmail() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const { accept } = useAuth()
  const [email, setEmail] = useState(state?.email || '')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState(state?.demo_code || '')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  // Shown when the server could not send the code (the reason comes from the server).
  const [problem, setProblem] = useState(state?.email_sent === false && !state?.demo_code ? state?.email_problem || 'Try again.' : '')
  const [wait, setWait] = useState(state?.email && !problem ? RESEND_SECONDS : 0)
  const asked = useRef(false)
  const [fields, setFields] = useState({})

  useEffect(() => { if (wait > 0) { const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t) } }, [wait])

  const resend = async (auto = false) => {
    setError(''); setInfo('')
    try {
      const r = await api('/api/auth/resend-verification', { method: 'POST', body: { email } })
      if (r.demo_code) setDemoCode(r.demo_code)
      if (r.email_sent === false && !r.demo_code) { setProblem(r.email_problem || 'Try again.'); setWait(0); return }
      setProblem('')
      setInfo(auto ? 'We sent you a new code.' : 'New code sent.')
      setWait(RESEND_SECONDS); setCode('')
    } catch (e) {
      if (e.status === 429) {  // a code was sent moments ago: wait instead of showing an error
        setWait(Number((e.message.match(/\d+/) || [RESEND_SECONDS])[0]))
        setInfo('A code was just sent.')
      } else setError(e.message)
    }
  }
  // Coming from Sign in with an unverified email: send a fresh code straight away.
  useEffect(() => { if (state?.resend && state?.email && !asked.current) { asked.current = true; resend(true) } }, []) // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault()
    const bad = check({ email, code }, { email: rules.email, code: rules.code6 })
    setFields(bad)
    if (Object.keys(bad).length) { focusFirst(bad, { email: 've-email', code: 've-code' }); return }
    setBusy(true); setError(''); setInfo('')
    try { accept(await api('/api/auth/verify-email', { method: 'POST', body: { email, code } })); navigate('/dashboard') }
    catch (err) { setError(err.message); setCode('') }
    finally { setBusy(false) }
  }

  return (
    <AuthShell title="Verify your email"
      subtitle={state?.email ? (problem ? <>Code not sent to <b className="font-medium text-ink-600">{state.email}</b></>
        : <>Code sent to <b className="font-medium text-ink-600">{state.email}</b></>) : undefined}
      footer={<>Didn't get the code?{' '}
        {wait > 0 ? <span className="whitespace-nowrap">Resend in {wait}s</span>
          : <button type="button" disabled={!email} onClick={() => resend()} className="whitespace-nowrap font-medium text-bark-500 hover:underline disabled:opacity-50">Resend code</button>}
      </>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorSlot error={error}>
          {problem ? <Alert kind="warn">We couldn't send the code. {problem}</Alert>
            : info ? <Alert kind="success">{info}</Alert>
            : demoCode ? <Alert kind="info">Demo code: <b className="font-mono tracking-widest">{demoCode}</b>.</Alert> : null}
        </ErrorSlot>
        {!state?.email && (
          <IconInput id="ve-email" error={fields.email} icon={MailIcon} type="email" required autoComplete="email" placeholder="Email address" aria-label="Email address"
            value={email} onChange={(e) => { setError(''); setFields({}); setEmail(e.target.value) }} />
        )}
        <IconInput id="ve-code" error={fields.code} icon={KeyIcon} required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          className="font-mono text-lg tracking-[0.4em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal"
          placeholder="6-digit code" aria-label="6-digit code" value={code}
          onChange={(e) => { setError(''); setFields({}); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)) }} />
        <button className="btn-primary btn-lg w-full" disabled={busy}>
          {busy ? <><Spinner /> Verifying your email…</> : 'Verify email'}
        </button>
        <p className="text-center text-sm text-ink-400">Wrong email? <Link to="/register" className="font-medium text-bark-500 hover:underline">Start again</Link></p>
      </form>
    </AuthShell>
  )
}
