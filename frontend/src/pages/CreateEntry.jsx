import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, today } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, Field, PageHeader, useAsync } from '../components/ui'

const MODES = [
  { key: 'verbatim', label: 'Verbatim', short: 'Kept exactly as you write it. No corrections.' },
  { key: 'light_fix', label: 'Light Fix', short: 'Small typos, spacing and capitals are fixed. The original is kept.' },
  { key: 'review', label: 'Review', short: 'Suggested fixes are shown after saving. Nothing changes until you accept.' },
]
const SAMPLE = 'today i recieved a letter from Lina , it was teh nicest surprise.'

/** What the chosen mode would do with the text (or a sample). Nothing is saved. */
function ModePreview({ mode, text }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const input = text.trim() ? text : SAMPLE
  useEffect(() => {
    const t = setTimeout(() => {
      api('/api/entries/preview', { method: 'POST', body: { text: input, mode } })
        .then((p) => { setPreview(p); setError('') }).catch((e) => setError(e.message))
    }, 300)
    return () => clearTimeout(t)
  }, [input, mode])

  if (error) return <Alert>{error}</Alert>
  if (!preview) return null
  return (
    <div className="rounded-xl bg-cream-100 p-3 text-sm">
      <p className="mb-1.5 text-xs font-medium text-ink-400">{text.trim() ? 'With your text' : 'With a sample'}:</p>
      {preview.mode === 'verbatim' && <p className="line-clamp-4">{preview.original}</p>}
      {preview.mode === 'light_fix' && (preview.revision_text
        ? <><p className="line-clamp-4">{preview.revision_text}</p>
          <p className="pt-1.5 text-xs text-ink-400">{preview.changes.length} fix{preview.changes.length === 1 ? '' : 'es'}, saved as a revision.</p></>
        : <p className="text-ink-400">Nothing to fix.</p>)}
      {preview.mode === 'review' && (preview.suggestions.length
        ? <><div className="line-clamp-6"><DiffView ops={preview.suggestions} /></div>
          <p className="pt-1.5 text-xs text-ink-400">You will be asked to accept these after saving.</p></>
        : <p className="text-ink-400">No suggestions.</p>)}
    </div>
  )
}

export default function CreateEntry() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialMode = MODES.some((m) => m.key === params.get('mode')) ? params.get('mode') : user.default_writing_mode || 'verbatim'
  const [mode, setMode] = useState(initialMode)
  const [showPreview, setShowPreview] = useState(false)
  const beneficiaries = useAsync(() => api('/api/beneficiaries'))
  const [form, setForm] = useState({ title: '', text: '', entry_date: today(), kind: 'text', recipient: '',
    release_on: '', release_on_death: true })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const active = (beneficiaries.data || []).filter((b) => b.active)
  const current = MODES.find((m) => m.key === mode)

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
        subtitle="Every word is sealed into your vault exactly as written." />
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
          <Card className="space-y-3">
            <p id="mode-label" className="label mb-0">Writing mode</p>
            <div role="radiogroup" aria-labelledby="mode-label" className="grid grid-cols-3 gap-1 rounded-xl bg-cream-200 p-1">
              {MODES.map((m) => (
                <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)}
                  className={`rounded-lg px-2 py-2 text-sm font-medium transition ${mode === m.key ? 'bg-white text-ink-700 shadow-paper' : 'text-ink-500 hover:text-ink-700'}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-400">{current.short}</p>
            <button type="button" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}
              className="text-sm font-medium text-bark-500 hover:underline">
              {showPreview ? 'Hide preview' : 'What’s the difference? Preview'}
            </button>
            {showPreview && <ModePreview mode={mode} text={form.text} />}
          </Card>

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
