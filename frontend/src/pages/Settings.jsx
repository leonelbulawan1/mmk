import { useState } from 'react'
import { api, fmtDate, tokenStore } from '../api'
import { useAuth } from '../auth'
import PasswordInput from '../components/PasswordInput'
import EmailNotices from '../components/EmailNotices'
import { ExecutorSettings } from '../components/Executor'
import { Alert, Card, Field, PageHeader, Spinner, useAsync } from '../components/ui'

export default function Settings() {
  const { user, setUser } = useAuth()
  const s = useAsync(() => api('/api/settings'))
  const isOwner = user.role === 'owner'
  const [profile, setProfile] = useState({ display_name: user.display_name, default_writing_mode: user.default_writing_mode })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [death, setDeath] = useState({ password: '', confirmation: '' })
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')

  const run = async (key, fn, ok) => {
    setBusy(key); setMsg({})
    try { await fn(); setMsg({ key, kind: 'success', text: ok }) } catch (e) { setMsg({ key, kind: 'error', text: e.message }) } finally { setBusy('') }
  }
  const note = (key) => msg.key === key && <div className="mb-3"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>

  const saveProfile = (e) => { e.preventDefault(); run('profile', async () => setUser(await api('/api/settings', { method: 'PUT', body: isOwner ? profile : { display_name: profile.display_name } })), 'Saved.') }
  const changePw = (e) => {
    e.preventDefault()
    run('pw', async () => {
      const r = await api('/api/auth/change-password', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } })
      tokenStore.set(r.token, tokenStore.remembered())  // stay signed in here; other devices are signed out
      setPw({ current_password: '', new_password: '' })
    }, 'Password changed. Your other devices have been signed out.')
  }
  const trigger = (e) => {
    e.preventDefault()
    setBusy('death'); setMsg({})
    api('/api/settings/death-trigger', { method: 'POST', body: death })
      .then((r) => {
        setUser({ ...user, death_triggered_at: r.death_triggered_at })
        const n = r.notices.length
        const emails = n === 0 ? 'No beneficiary had anything released, so no emails were needed.'
          : r.emails_sent === n ? `${n} beneficiar${n === 1 ? 'y was' : 'ies were'} emailed.`
          : `${r.emails_sent} of ${n} email notice${n === 1 ? '' : 's'} sent; see the list below.`
        setMsg({ key: 'death', kind: n === 0 || r.emails_sent === n ? 'success' : 'warn', text: `The vault is sealed and the policy is frozen. After-death releases are now active. ${emails}` })
      })
      .catch((e) => setMsg({ key: 'death', kind: 'error', text: e.message }))
      .finally(() => setBusy(''))
  }

  if (s.loading) return <Spinner />
  const phrase = s.data?.confirm_phrase || 'SEAL MY VAULT'

  return (
    <>
      <PageHeader eyebrow="your account" title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-2xl font-semibold">Profile</h2>
          {note('profile')}
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Display name"><input className="input" required value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={user.email} disabled /></Field>
            {isOwner && (
              <Field label="Default writing mode" hint="Pre-selected when you start a new entry.">
                <select className="input" value={profile.default_writing_mode} onChange={(e) => setProfile({ ...profile, default_writing_mode: e.target.value })}>
                  <option value="verbatim">Verbatim</option><option value="light_fix">Light Fix</option><option value="review">Review</option>
                </select>
              </Field>
            )}
            <button className="btn-primary" disabled={busy === 'profile'}>Save</button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-4 text-2xl font-semibold">Password</h2>
          {note('pw')}
          <form onSubmit={changePw} className="space-y-4">
            <Field label="Current password"><PasswordInput required autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters, with letters and numbers"><PasswordInput required minLength={8} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <button className="btn-primary" disabled={busy === 'pw'}>Change password</button>
          </form>
          {!s.data?.prolog_available && <div className="mt-4"><Alert kind="warn">SWI-Prolog is not available on the server, so nothing can be shared (the system fails closed).</Alert></div>}
        </Card>

        {isOwner && <ExecutorSettings />}

        {isOwner && (
          <Card className="border-rose-600/30 lg:col-span-2">
            <h2 className="text-2xl font-semibold text-rose-600">Death trigger</h2>
            {note('death')}
            {user.death_triggered_at ? (
              <>
                <p className="mt-2 text-sm">Activated on {fmtDate(user.death_triggered_at)}. The vault is sealed, the legacy policy is frozen, and “after death” releases are in effect.</p>
                <EmailNotices />
              </>
            ) : (
              <>
                <p className="mt-2 max-w-3xl text-sm text-ink-500">
                  Activating this is permanent. It seals your vault so no entry can be added or revised, freezes your legacy policy
                  exactly as it is now, and opens everything you marked for release “after death”. Each beneficiary who then has
                  something to read is automatically emailed a short notice with a sign-in link (never any diary content).
                  Use this yourself if you want to seal your diary now. After your passing, your executor (above) starts it instead, without your password.
                </p>
                <form onSubmit={trigger} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
                  <Field label="Your password"><PasswordInput required value={death.password} onChange={(e) => setDeath({ ...death, password: e.target.value })} /></Field>
                  <Field label={<>Type <b>{phrase}</b></>}><input className="input font-mono" required value={death.confirmation} onChange={(e) => setDeath({ ...death, confirmation: e.target.value })} /></Field>
                  <button className="btn-danger" disabled={busy === 'death' || death.confirmation !== phrase}>Seal vault permanently</button>
                </form>
              </>
            )}
          </Card>
        )}
      </div>
    </>
  )
}
