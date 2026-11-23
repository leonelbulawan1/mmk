import { useState } from 'react'
import { api, fmtDate, tokenStore } from '../api'
import { useAuth } from '../auth'
import PasswordInput from '../components/PasswordInput'
import EmailNotices from '../components/EmailNotices'
import { ExecutorSettings } from '../components/Executor'
import { Alert, Field, PageHeader, Section, Spinner, useAsync } from '../components/ui'

export default function Settings() {
  const { user, setUser } = useAuth()
  const s = useAsync(() => api('/api/settings'))
  const isOwner = user.role === 'owner'
  const [profile, setProfile] = useState({ display_name: user.display_name, default_writing_mode: user.default_writing_mode,
    allow_ai_answers: user.allow_ai_answers !== false, email_letters: user.email_letters !== false })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [death, setDeath] = useState({ password: '', confirmation: '' })
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState('')

  const run = async (key, fn, ok) => {
    setBusy(key); setMsg({})
    try { await fn(); setMsg({ key, kind: 'success', text: ok }) } catch (e) { setMsg({ key, kind: 'error', text: e.message }) } finally { setBusy('') }
  }
  const note = (key) => msg.key === key && <div className="mb-3"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>

  const saveProfile = (e) => { e.preventDefault(); run('profile', async () => setUser(await api('/api/settings', { method: 'PUT', body: isOwner
    ? { display_name: profile.display_name, default_writing_mode: profile.default_writing_mode, ...(user.death_triggered_at ? {} : { allow_ai_answers: profile.allow_ai_answers }) }
    : { display_name: profile.display_name, email_letters: profile.email_letters } })), 'Saved.') }
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
      <PageHeader title="Settings" subtitle={isOwner ? 'Your profile, sign-in, executor and vault.' : 'Your profile and sign-in.'} />
      <div className="grid items-start gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-8 lg:block">
          <ul className="space-y-1 text-sm">
            {[['profile', 'Profile'], ['password', 'Password'], ...(isOwner ? [['executor', 'Executor'], ['seal', 'Seal vault']] : [])].map(([id, l]) => (
              <li key={id}><a href={`#${id}`} className="block rounded-lg px-3 py-2 font-medium text-ink-600 hover:bg-cream-200 hover:text-ink-700">{l}</a></li>
            ))}
          </ul>
        </nav>
        <div className="max-w-3xl space-y-6">
        <Section id="profile" title="Profile" description="How you appear in MMK">
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
            {isOwner ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="checkbox mt-0.5" checked={profile.allow_ai_answers} disabled={!!user.death_triggered_at}
                  onChange={(e) => setProfile({ ...profile, allow_ai_answers: e.target.checked })} />
                <span>Let the AI assistant answer my beneficiaries' questions
                  <span className="block text-xs text-ink-400">It only uses entries your legacy policy lets each person see, never pretends to be you, and shows where each answer comes from. Turn this off and beneficiaries can still read what you shared, but cannot ask questions. The change is recorded in your audit log.</span></span>
              </label>
            ) : (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="checkbox mt-0.5" checked={profile.email_letters}
                  onChange={(e) => setProfile({ ...profile, email_letters: e.target.checked })} />
                <span>Email me when a letter opens for me
                  <span className="block text-xs text-ink-400">The letter appears on your MMK home page either way.</span></span>
              </label>
            )}
            <div className="flex justify-end border-t border-cream-300/80 pt-4"><button className="btn-primary" disabled={busy === 'profile'}>Save profile</button></div>
          </form>
        </Section>

        <Section id="password" title="Password" description="Changing it signs out your other devices">
          {note('pw')}
          <form onSubmit={changePw} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current password"><PasswordInput required autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" hint="At least 8 characters, with letters and numbers"><PasswordInput required minLength={8} autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            </div>
            <div className="flex justify-end border-t border-cream-300/80 pt-4"><button className="btn-primary" disabled={busy === 'pw'}>Change password</button></div>
          </form>
          {!s.data?.prolog_available && <div className="mt-4"><Alert kind="warn">SWI-Prolog is not available on the server, so nothing can be shared (the system fails closed).</Alert></div>}
        </Section>

        {isOwner && <ExecutorSettings />}

        {isOwner && (
          <Section id="seal" className="border-rose-600/30" title={<h2 id="seal-h" className="text-lg font-semibold text-rose-600">Seal vault (death trigger)</h2>}
            description="Permanent. Use only if you want to seal your diary now.">
            {note('death')}
            {user.death_triggered_at ? (
              <>
                <p className="text-sm">Activated on {fmtDate(user.death_triggered_at)}. The vault is sealed, the legacy policy is frozen, and “after death” releases are in effect.</p>
                <EmailNotices />
              </>
            ) : (
              <>
                <p className="max-w-3xl text-sm text-ink-500">
                  Activating this is permanent. It seals your vault so no entry can be added or revised, freezes your legacy policy
                  exactly as it is now, and opens everything you marked for release “after death”. Each beneficiary who then has
                  something to read is automatically emailed a short notice with a sign-in link (never any diary content).
                  Use this yourself if you want to seal your diary now. After your passing, your executor (above) starts it instead, without your password.
                </p>
                <form onSubmit={trigger} className="mt-5 grid gap-4 border-t border-cream-300/80 pt-5 sm:grid-cols-3 sm:items-end">
                  <Field label="Your password"><PasswordInput required value={death.password} onChange={(e) => setDeath({ ...death, password: e.target.value })} /></Field>
                  <Field label={<>Type <b>{phrase}</b></>}><input className="input font-mono" required value={death.confirmation} onChange={(e) => setDeath({ ...death, confirmation: e.target.value })} /></Field>
                  <button className="btn-danger" disabled={busy === 'death' || death.confirmation !== phrase}>Seal vault permanently</button>
                </form>
              </>
            )}
          </Section>
        )}
        </div>
      </div>
    </>
  )
}
