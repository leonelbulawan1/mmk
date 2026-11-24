import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, download, fmtDate, tokenStore } from '../api'
import { useAuth } from '../auth'
import PasswordInput from '../components/PasswordInput'
import EmailNotices from '../components/EmailNotices'
import { ExecutorSettings } from '../components/Executor'
import { Alert, Field, PageHeader, Section, Spinner, useAsync, useToast } from '../components/ui'
import { check, rules } from '../validation'

export default function Settings() {
  const { user, setUser } = useAuth()
  const s = useAsync(() => api('/api/settings'))
  const isOwner = user.role === 'owner'
  const [profile, setProfile] = useState({ first_name: user.first_name || '', last_name: user.last_name || '', default_writing_mode: user.default_writing_mode,
    allow_ai_answers: user.allow_ai_answers !== false, email_letters: user.email_letters !== false })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [death, setDeath] = useState({ password: '', confirmation: '' })
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')
  const [fields, setFields] = useState({})
  const toast = useToast()

  const run = async (key, fn, ok) => {
    setBusy(key); setMsg({})
    try { await fn(); toast(ok) } catch (e) { setMsg({ key, kind: 'error', text: e.message }) } finally { setBusy('') }
  }
  const note = (key) => msg.key === key && <div className="mb-3"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>

  const saveProfile = (e) => {
    e.preventDefault()
    const bad = check(profile, { first_name: rules.required('your first name') })
    setFields(bad); if (bad.first_name) return
    run('profile', async () => setUser(await api('/api/settings', { method: 'PUT', body: isOwner
    ? { first_name: profile.first_name, last_name: profile.last_name, default_writing_mode: profile.default_writing_mode, ...(user.death_triggered_at ? {} : { allow_ai_answers: profile.allow_ai_answers }) }
    : { first_name: profile.first_name, last_name: profile.last_name, email_letters: profile.email_letters } })), 'Profile saved.')
  }
  const changePw = (e) => {
    e.preventDefault()
    const bad = check(pw, { current_password: (v) => (v ? '' : 'Enter your current password.'), new_password: rules.newPassword })
    setFields(bad); if (Object.keys(bad).length) return
    run('pw', async () => {
      const r = await api('/api/auth/change-password', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } })
      tokenStore.set(r.token, tokenStore.remembered())  // stay signed in here; other devices are signed out
      setPw({ current_password: '', new_password: '' })
    }, 'Password changed.')
  }
  const trigger = (e) => {
    e.preventDefault()
    const bad = check(death, { password: rules.password, confirmation: rules.phrase(s.data?.confirm_phrase || 'SEAL MY VAULT') })
    setFields(bad); if (Object.keys(bad).length) return
    setBusy('death'); setMsg({})
    api('/api/settings/death-trigger', { method: 'POST', body: death })
      .then((r) => {
        setUser({ ...user, death_triggered_at: r.death_triggered_at })
        const n = r.notices.length
        const emails = n === 0 ? 'No emails needed.'
          : r.emails_sent === n ? `${n} beneficiar${n === 1 ? 'y was' : 'ies were'} emailed.`
          : `${r.emails_sent} of ${n} email notice${n === 1 ? '' : 's'} sent; see the list below.`
        setMsg({ key: 'death', kind: n === 0 || r.emails_sent === n ? 'success' : 'warn', text: `Vault sealed. ${emails}` })
      })
      .catch((e) => setMsg({ key: 'death', kind: 'error', text: e.message }))
      .finally(() => setBusy(''))
  }

  if (s.loading) return <Spinner label="Loading settings" />
  const phrase = s.data?.confirm_phrase || 'SEAL MY VAULT'

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid items-start gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-8 lg:block">
          <ul className="space-y-1 text-sm">
            {[['profile', 'Profile'], ['password', 'Password'], ...(isOwner ? [['executor', 'Executor']] : []), ['data', 'Your data'], ...(isOwner ? [['seal', 'Seal vault'], ['delete', 'Delete account']] : [])].map(([id, l]) => (
              <li key={id}><a href={`#${id}`} className="block rounded-lg px-3 py-2 font-medium text-ink-600 hover:bg-cream-200 hover:text-ink-700">{l}</a></li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
        <Section id="profile" title="Profile">
          {note('profile')}
          <form onSubmit={saveProfile} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" error={fields.first_name}><input className={`input ${fields.first_name ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} required autoComplete="given-name" aria-invalid={!!fields.first_name} value={profile.first_name} onChange={(e) => { setFields({}); setProfile({ ...profile, first_name: e.target.value }) }} /></Field>
              <Field label="Last name"><input className="input" autoComplete="family-name" value={profile.last_name} onChange={(e) => setProfile({ ...profile, last_name: e.target.value })} /></Field>
            </div>
            <Field label="Email"><input className="input" value={user.email} disabled /></Field>
            {isOwner && (
              <Field label="Default writing mode">
                <select className="input" value={profile.default_writing_mode} onChange={(e) => setProfile({ ...profile, default_writing_mode: e.target.value })}>
                  <option value="verbatim">Verbatim</option><option value="light_fix">Light Fix</option><option value="review">Review</option>
                </select>
              </Field>
            )}
            {isOwner ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="checkbox mt-0.5" checked={profile.allow_ai_answers} disabled={!!user.death_triggered_at}
                  onChange={(e) => setProfile({ ...profile, allow_ai_answers: e.target.checked })} />
                <span>Let the AI assistant answer my beneficiaries' questions</span>
              </label>
            ) : (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="checkbox mt-0.5" checked={profile.email_letters}
                  onChange={(e) => setProfile({ ...profile, email_letters: e.target.checked })} />
                <span>Email me when a letter opens for me</span>
              </label>
            )}
            <div className="flex justify-end border-t border-cream-300/80 pt-4"><button className="btn-primary" disabled={busy === 'profile'}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</button></div>
          </form>
        </Section>

        <Section id="password" title="Password">
          {note('pw')}
          <form onSubmit={changePw} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current password"><PasswordInput required autoComplete="current-password" value={pw.current_password} error={fields.current_password} onChange={(e) => { setFields({}); setPw({ ...pw, current_password: e.target.value }) }} /></Field>
            <Field label="New password"><PasswordInput required minLength={8} autoComplete="new-password" value={pw.new_password} error={fields.new_password} hint="8+ characters, letters and numbers" onChange={(e) => { setFields({}); setPw({ ...pw, new_password: e.target.value }) }} /></Field>
            </div>
            <div className="flex justify-end border-t border-cream-300/80 pt-4"><button className="btn-primary" disabled={busy === 'pw'}>{busy === 'pw' ? 'Changing password…' : 'Change password'}</button></div>
          </form>
          {!s.data?.prolog_available && <div className="mt-4"><Alert kind="warn">Access engine unavailable. Nothing is shared.</Alert></div>}
        </Section>

        {isOwner && <ExecutorSettings />}

        <YourData isOwner={isOwner} />

        {isOwner && (
          <Section id="seal" className="border-rose-600/30" title={<h2 id="seal-h" className="text-lg font-semibold text-rose-600">Seal vault</h2>}
            description="Permanent.">
            {note('death')}
            {user.death_triggered_at ? (
              <>
                <p className="text-sm">Sealed on {fmtDate(user.death_triggered_at)}</p>
                <EmailNotices />
              </>
            ) : (
              <>
                <form onSubmit={trigger} noValidate className="grid gap-4 sm:grid-cols-3 sm:items-end">
                  <Field label="Your password"><PasswordInput required value={death.password} error={fields.password} onChange={(e) => { setFields({}); setDeath({ ...death, password: e.target.value }) }} /></Field>
                  <Field label={<>Type <b>{phrase}</b></>} error={fields.confirmation}><input className={`input font-mono ${fields.confirmation ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} required aria-invalid={!!fields.confirmation} value={death.confirmation} onChange={(e) => { setFields({}); setDeath({ ...death, confirmation: e.target.value }) }} /></Field>
                  <button className="btn-danger" disabled={busy === 'death'}>{busy === 'death' ? 'Sealing vault…' : 'Seal vault permanently'}</button>
                </form>
              </>
            )}
          </Section>
        )}

        {isOwner && !user.death_triggered_at && <DeleteAccount />}
        </div>
      </div>
    </>
  )
}

// Download everything MMK keeps about you.
function YourData({ isOwner }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const get = async () => {
    setBusy(true)
    try { await download('/api/account/export', `mmk-my-data-${new Date().toISOString().slice(0, 10)}.json`); toast('Your data was downloaded.') }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Section id="data" title="Your data">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink-500">All data · JSON</span>
        <button type="button" className="btn-secondary" disabled={busy} onClick={get}>{busy ? 'Preparing your file…' : 'Download my data'}</button>
      </div>
    </Section>
  )
}

// Erase the account and the whole diary. Needs the password and a typed phrase.
const DELETE_PHRASE = 'DELETE MY ACCOUNT'
function DeleteAccount() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ password: '', confirmation: '' })
  const [fields, setFields] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const bad = check(form, { password: rules.password, confirmation: rules.phrase(DELETE_PHRASE) })
    setFields(bad); setError('')
    if (Object.keys(bad).length) return
    setBusy(true)
    try {
      await api('/api/account/delete', { method: 'POST', body: form })
      try { sessionStorage.setItem('mmk.notice', 'account-deleted') } catch { /* private mode */ }
      logout()
      navigate('/login', { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Section id="delete" className="border-rose-600/30" title={<h2 id="delete-h" className="text-lg font-semibold text-rose-600">Delete account</h2>}
      description="Permanent.">
      {error && <div className="mb-4"><Alert onClose={() => setError('')}>{error}</Alert></div>}
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-3 sm:items-end">
        <Field label="Your password"><PasswordInput autoComplete="current-password" value={form.password} error={fields.password} onChange={(e) => { setFields({}); setForm({ ...form, password: e.target.value }) }} /></Field>
        <Field label={<>Type <b>{DELETE_PHRASE}</b></>} error={fields.confirmation}>
          <input className={`input font-mono ${fields.confirmation ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''}`} aria-invalid={!!fields.confirmation}
            value={form.confirmation} onChange={(e) => { setFields({}); setForm({ ...form, confirmation: e.target.value }) }} />
        </Field>
        <button className="btn-danger" disabled={busy}>{busy ? 'Deleting account…' : 'Delete my account'}</button>
      </form>
    </Section>
  )
}
