import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, draftStore, today, tokenStore } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, Field, PageHeader, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'

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
  const blank = { title: '', text: '', entry_date: today(), kind: 'text', recipient: '', release_on: '', release_on_death: true }
  // A draft left from earlier (navigated away, refreshed, browser closed while "Keep me signed in").
  const [draft] = useState(() => {
    const d = draftStore.get(user.id)
    return d && (d.form?.text?.trim() || d.form?.title?.trim()) ? d : null
  })
  const [mode, setMode] = useState(draft?.mode || initialMode)
  const [showPreview, setShowPreview] = useState(false)
  const beneficiaries = useAsync(() => api('/api/beneficiaries'))
  const [form, setForm] = useState(draft ? { ...blank, ...draft.form } : blank)
  const [restored, setRestored] = useState(!!draft)
  const [draftSaved, setDraftSaved] = useState(false)
  const [release, setRelease] = useState(null)   // does the policy release letters to the chosen recipient?
  const [addingRelease, setAddingRelease] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const active = (beneficiaries.data || []).filter((b) => b.active)
  const current = MODES.find((m) => m.key === mode)
  const hasContent = !!(form.text.trim() || form.title.trim())

  // Save the draft as the person types; drop it once the page is empty.
  useEffect(() => {
    const t = setTimeout(() => {
      if (hasContent) { draftStore.set(user.id, { form, mode }); setDraftSaved(true) }
      else { draftStore.clear(user.id); setDraftSaved(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [form, mode, hasContent, user.id])

  // A session-only draft disappears with the tab, so warn before closing or reloading it.
  useEffect(() => {
    if (!hasContent || tokenStore.remembered()) return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasContent])

  // A letter is only delivered if the policy releases letters to its recipient.
  useEffect(() => {
    setRelease(null)
    if (form.kind !== 'letter' || !form.recipient) return
    let live = true
    api(`/api/policy/letter-release/${encodeURIComponent(form.recipient)}`)
      .then((r) => live && setRelease(r)).catch(() => {})
    return () => { live = false }
  }, [form.kind, form.recipient])

  const addRelease = async () => {
    setAddingRelease(true); setError('')
    try { setRelease(await api(`/api/policy/letter-release/${encodeURIComponent(form.recipient)}`, { method: 'POST' })) }
    catch (err) { setError(err.message) }
    setAddingRelease(false)
  }
  const discardDraft = () => { draftStore.clear(user.id); setForm(blank); setRestored(false); setDraftSaved(false) }
  const recipientName = active.find((b) => b.handle === form.recipient)?.display_name || form.recipient

  if (user.death_triggered_at) return <Alert kind="warn">The vault is sealed; new entries cannot be written.</Alert>

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body = { title: form.title, text: form.text, entry_date: form.entry_date, mode, kind: form.kind }
      if (form.kind === 'letter') Object.assign(body, {
        recipient: form.recipient, release_on: form.release_on || null, release_on_death: form.release_on_death })
      const res = await api('/api/entries', { method: 'POST', body })
      draftStore.clear(user.id)
      navigate(`/entries/${res.entry.id}`, { state: { justCreated: true } })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  const isLetter = form.kind === 'letter'
  const futureDate = form.entry_date > today()
  const noRelease = isLetter && !form.release_on && !form.release_on_death
  const noRecipient = isLetter && !form.recipient
  const canSave = !busy && !!form.text.trim() && !futureDate && !noRelease && !noRecipient
  const setKind = (kind) => setForm({ ...form, kind })
  const words = form.text.trim() ? form.text.trim().split(/\s+/).length : 0

  return (
    <>
      <PageHeader eyebrow="a new page" title={form.kind === 'letter' ? 'Write a letter' : 'Write an entry'}
        subtitle="Every word is sealed into your vault exactly as written." />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div role="radiogroup" aria-label="What are you writing?" className="mb-4 inline-flex rounded-xl bg-cream-200 p-1">
            {[['text', 'Diary entry', 'entries'], ['letter', 'Letter', 'letters']].map(([k, label, icon]) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => setKind(k)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${form.kind === k ? 'bg-white text-ink-700 shadow-paper' : 'text-ink-500 hover:text-ink-700'}`}>
                <NavIcon name={icon} size={16} />{label}
              </button>
            ))}
          </div>
          <Alert>{error}</Alert>
          <input className="mt-2 w-full border-0 bg-transparent text-3xl font-semibold placeholder:text-ink-400/40 focus:outline-none"
            placeholder="A title, if you like" value={form.title} onChange={set('title')} aria-label="Title" maxLength={200} />
          <textarea required className="paper-lines mt-4 min-h-[420px] w-full resize-y border-0 bg-transparent text-lg text-ink-600 placeholder:text-ink-400/40 focus:outline-none"
            placeholder={form.kind === 'letter' ? 'Dear…' : 'Today I…'} value={form.text} onChange={set('text')} aria-label="Entry text" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
            <span aria-live="polite">
              {restored ? <>Draft restored · <button type="button" onClick={discardDraft} className="font-medium text-bark-500 hover:underline">Discard draft</button></>
                : draftSaved ? 'Draft saved on this device' : ''}
            </span>
            <span>{words} words</span>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-cream-300 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-400">Saved entries can never be edited or deleted, only revised.</p>
            <button className="btn-primary px-6 py-3" disabled={!canSave}>{busy ? 'Sealing…' : isLetter ? 'Save and seal letter' : 'Save and seal entry'}</button>
          </div>
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
            <Field label={isLetter ? 'Date written' : 'Date of this memory'} error={futureDate ? 'This date is in the future. Choose today or an earlier day.' : ''}>
              <input className="input" type="date" required max={today()} value={form.entry_date} onChange={set('entry_date')} /></Field>
            {form.kind === 'letter' && (
              <>
                {active.length === 0 ? (
                  <Alert kind="warn">Add a beneficiary first. <Link className="underline" to="/beneficiaries">Manage beneficiaries</Link></Alert>
                ) : (
                  <Field label="Recipient">
                    <select className="input" required value={form.recipient} onChange={set('recipient')}>
                      <option value="">Choose…</option>
                      {active.map((b) => <option key={b.id} value={b.handle}>{b.display_name}{b.relationship ? ` · ${b.relationship}` : ''}</option>)}
                    </select>
                  </Field>
                )}
                <fieldset className="space-y-3">
                  <legend className="label">When may {recipientName || 'they'} open it?</legend>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="checkbox" checked={form.release_on_death} onChange={set('release_on_death')} /> After my death</label>
                  <Field label="On a date (optional)" hint="For example, a birthday. The letter opens on that day, but never while you are alive.">
                    <input className="input" type="date" min={today()} value={form.release_on} onChange={set('release_on')} /></Field>
                  {noRelease && <p className="text-xs text-rose-600" role="alert">Choose at least one: after your death, or a date.</p>}
                </fieldset>
                {release && !release.released && (
                  <Alert kind="warn">
                    Your legacy policy doesn't release letters to {recipientName} yet, so {recipientName} would never receive this letter. Adding it releases their letters after your death.
                    <button type="button" onClick={addRelease} disabled={addingRelease} className="btn-secondary mt-2 w-full py-2 text-sm">
                      {addingRelease ? 'Adding…' : 'Add to my policy'}
                    </button>
                  </Alert>
                )}
                {release?.released && (
                  <p className="flex gap-1.5 text-xs text-sage-600"><span aria-hidden>✓</span>
                    <span>Your policy releases letters to {recipientName}{release.version ? ` (added as policy v${release.version})` : ''}.</span></p>
                )}
              </>
            )}
          </Card>
        </div>
      </form>
    </>
  )
}
