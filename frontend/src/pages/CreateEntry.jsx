import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, today } from '../api'
import { useAuth } from '../auth'
import { Alert, Card, Field, PageHeader, useAsync } from '../components/ui'

const MODE_LABEL = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

export default function CreateEntry() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const mode = MODE_LABEL[params.get('mode')] ? params.get('mode') : user.default_writing_mode || 'verbatim'
  const beneficiaries = useAsync(() => api('/api/beneficiaries'))
  const [form, setForm] = useState({ title: '', text: '', entry_date: today(), kind: 'text', recipient: '',
    release_on: '', release_on_death: true })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const active = (beneficiaries.data || []).filter((b) => b.active)

  if (user.death_triggered_at) return <Alert kind="warn">The vault is sealed; new entries cannot be written.</Alert>

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body = { title: form.title, text: form.text, entry_date: form.entry_date, mode, kind: form.kind }
      if (form.kind === 'letter') Object.assign(body, {
        recipient: form.recipient, release_on: form.release_on || null, release_on_death: form.release_on_death })
      const res = await api('/api/entries', { method: 'POST', body })
      navigate(`/entries/${res.entry.id}`, { state: { justCreated: true } })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const words = form.text.trim() ? form.text.trim().split(/\s+/).length : 0

  return (
    <>
      <PageHeader eyebrow="a new page" title={form.kind === 'letter' ? 'Write a letter' : 'Write an entry'}
        subtitle={<>Mode: <b>{MODE_LABEL[mode]}</b> · <Link to="/write" className="text-bark-500 underline">change</Link></>} />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Alert>{error}</Alert>
          <input className="mt-2 w-full border-0 bg-transparent text-3xl font-semibold placeholder:text-ink-400/40 focus:outline-none"
            placeholder="A title, if you like" value={form.title} onChange={set('title')} aria-label="Title" maxLength={200} />
          <textarea required className="paper-lines mt-4 min-h-[420px] w-full resize-y border-0 bg-transparent text-lg text-ink-600 placeholder:text-ink-400/40 focus:outline-none"
            placeholder={form.kind === 'letter' ? 'Dear…' : 'Today I…'} value={form.text} onChange={set('text')} aria-label="Entry text" />
          <p className="text-right text-xs text-ink-400">{words} words</p>
        </Card>

        <div className="space-y-6">
          <Card className="space-y-4">
            <Field label="Date of this memory"><input className="input" type="date" required value={form.entry_date} onChange={set('entry_date')} /></Field>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={set('kind')}>
                <option value="text">Diary entry</option>
                <option value="letter">Letter to a beneficiary</option>
              </select>
            </Field>
            {form.kind === 'letter' && (
              <>
                {active.length === 0 ? (
                  <Alert kind="warn">Add a beneficiary first. <Link className="underline" to="/beneficiaries">Manage beneficiaries</Link></Alert>
                ) : (
                  <Field label="Recipient">
                    <select className="input" required value={form.recipient} onChange={set('recipient')}>
                      <option value="">Choose…</option>
                      {active.map((b) => <option key={b.id} value={b.handle}>{b.display_name} ({b.handle})</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Release on date" hint="Optional. The letter opens on this day.">
                  <input className="input" type="date" value={form.release_on} onChange={set('release_on')} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" checked={form.release_on_death} onChange={set('release_on_death')} /> Release after my death trigger</label>
                <p className="text-xs text-ink-400">Your legacy policy must also contain a <code>release letters to …</code> statement for this person.</p>
              </>
            )}
          </Card>
          <button className="btn-primary w-full py-3" disabled={busy || !form.text.trim()}>{busy ? 'Sealing…' : 'Save and seal entry'}</button>
          <p className="text-center text-xs text-ink-400">Saved entries can never be edited or deleted, only revised.</p>
        </div>
      </form>
    </>
  )
}
