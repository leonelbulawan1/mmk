import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Card, Empty, Field, PageHeader, Spinner, Tag, useAsync } from '../components/ui'

// In the browser edition links cannot open a specific page, so only the code is shown there.
const WEB = import.meta.env.VITE_WEB_RUNTIME === '1'

const blank = { display_name: '', email: '', handle: '', relationship: '' }

export default function Beneficiaries() {
  const { user } = useAuth()
  const sealed = !!user.death_triggered_at
  const list = useAsync(() => api('/api/beneficiaries'))
  const [form, setForm] = useState(blank)
  const [invite, setInvite] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v, ...(k === 'display_name' && !f._handleTouched ? { handle: v.split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '') } : {}), ...(k === 'handle' ? { _handleTouched: true } : {}) }))
  }

  const create = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { _handleTouched, ...body } = form
      const res = await api('/api/beneficiaries', { method: 'POST', body })
      setInvite({ name: res.beneficiary.display_name, email: res.beneficiary.email, code: res.invite_code, link: res.invite_link })
      setForm(blank); list.reload()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const reissue = async (b) => {
    try {
      const res = await api(`/api/beneficiaries/${b.id}/invite`, { method: 'POST' })
      setInvite({ name: b.display_name, email: b.email, code: res.invite_code, link: res.invite_link })
    } catch (err) { setError(err.message) }
  }
  const toggle = async (b) => {
    try { await api(`/api/beneficiaries/${b.id}`, { method: 'PATCH', body: { active: !b.active } }); list.reload() }
    catch (err) { setError(err.message) }
  }

  return (
    <>
      <PageHeader eyebrow="the people you trust" title="Beneficiaries"
        subtitle="Register the people who may remember you through your diary. They see nothing while you are alive; after your passing, only what your legacy policy allows." />
      <div className="mb-4 space-y-3">
        <Alert onClose={() => setError('')}>{error}</Alert>
        {invite && (
          <Alert kind="success" onClose={() => setInvite(null)}>
            Invite for <b>{invite.name}</b> ({invite.email}): <code className="mx-1 rounded bg-white/70 px-2 py-0.5 font-mono text-base">{invite.code}</code>
            Share it privately. It works once and is shown only now.{' '}
            They activate it from the home page: <b>I received an invitation</b>.
            {invite.link && !WEB && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span>Or send them this one-click link:</span>
                <code className="max-w-full truncate rounded bg-white/70 px-2 py-0.5 text-xs">{invite.link}</code>
                <button type="button" className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => navigator.clipboard?.writeText(invite.link).catch(() => {})}>Copy link</button>
              </div>
            )}
          </Alert>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {list.loading ? <Spinner /> : !list.data?.length ? (
            <Empty title="No beneficiaries yet">Add someone on the right, then write a policy for them.</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {list.data.map((b) => (
                <Card key={b.id} className={b.active ? '' : 'opacity-60'}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-2xl font-semibold">{b.display_name}</h3>
                      <p className="text-sm text-ink-400">{b.relationship || 'Beneficiary'} · {b.email}</p>
                    </div>
                    <Tag tone="ink">{b.handle}</Tag>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Tag>{b.activated ? 'Account active' : 'Invite pending'}</Tag>
                    {!b.active && <Tag tone="bark">Deactivated</Tag>}
                    {user.executor?.id === b.id && <Tag tone="ink">Executor</Tag>}
                    <Tag>Added {fmtDate(b.created_at)}</Tag>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                  {!sealed && (
                    <>
                      {!b.activated && <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => reissue(b)}>New invite code</button>}
                      <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => toggle(b)}>{b.active ? 'Deactivate' : 'Reactivate'}</button>
                      <Link className="btn-ghost px-3 py-1.5 text-xs" to={`/assistant?as=${b.handle}`}>Preview as {b.display_name.split(' ')[0]}</Link>
                    </>
                  )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {!sealed && (
          <Card>
            <h2 className="text-2xl font-semibold">Register someone</h2>
            <form onSubmit={create} className="mt-4 space-y-4">
              <Field label="Full name"><input className="input" required value={form.display_name} onChange={set('display_name')} /></Field>
              <Field label="Email"><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
              <Field label="Policy handle" hint="Used in your policy, e.g. allow maria …  (lowercase)">
                <input className="input font-mono" required pattern="[a-z][a-z0-9_]{1,31}" value={form.handle} onChange={set('handle')} /></Field>
              <Field label="Relationship"><input className="input" placeholder="Daughter, friend…" value={form.relationship} onChange={set('relationship')} /></Field>
              <button className="btn-primary w-full" disabled={busy}>{busy ? 'Adding…' : 'Add and create invite'}</button>
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
