import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, draftStore, today, tokenStore } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, Field, LegalDisclaimer, PageHeader, useAsync } from '../components/ui'
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

// One labelled row of the composer header, like the To / Subject lines of an email.
function Row({ label, htmlFor, children, error }) {
  return (
  <div className="border-b border-cream-300 px-5 py-2.5 sm:px-6">
    <div className="flex min-h-[2.25rem] flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={htmlFor} className="w-16 shrink-0 text-sm text-ink-400">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>
    </div>
    {error && <p className="mt-1 text-xs text-rose-600 sm:pl-[4.75rem]" role="alert">{error}</p>}
  </div>
  )
}
const bare = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-ink-700 placeholder:text-ink-400/60 focus:outline-none focus:ring-0'

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
      <PageHeader eyebrow="a new page" title={isLetter ? 'Write a letter' : 'Write an entry'}
        subtitle="Every word is sealed into your vault exactly as written." />
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className="card overflow-hidden p-0">
          {/* Window bar: what you are writing, and the draft status */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-300 bg-cream-100/70 px-4 py-2.5 sm:px-5">
            <div role="radiogroup" aria-label="What are you writing?" className="inline-flex rounded-xl bg-cream-200 p-1">
              {[['text', 'Diary entry', 'entries'], ['letter', 'Letter', 'letters']].map(([k, label, icon]) => (
                <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => setKind(k)}
                  className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${form.kind === k ? 'bg-white text-ink-700 shadow-paper' : 'text-ink-500 hover:text-ink-700'}`}>
                  <NavIcon name={icon} size={16} />{label}
                </button>
              ))}
            </div>
            <span className="text-xs text-ink-400" aria-live="polite">
              {restored ? <>Draft restored · <button type="button" onClick={discardDraft} className="font-medium text-bark-500 hover:underline">Discard</button></>
                : draftSaved ? 'Draft saved on this device' : ''}
            </span>
          </div>

          {error && <div className="px-5 pt-4 sm:px-6"><Alert>{error}</Alert></div>}

          {/* Header rows, like an email: To / Subject / Date / Opens */}
          {isLetter && (
            <Row label="To" htmlFor="to">
              {active.length === 0 ? (
                <span className="text-sm text-bark-600">Add a beneficiary first. <Link className="underline" to="/beneficiaries">Manage beneficiaries</Link></span>
              ) : (
                <select id="to" required value={form.recipient} onChange={set('recipient')} className={`${bare} cursor-pointer appearance-none`}>
                  <option value="">Choose a beneficiary…</option>
                  {active.map((b) => <option key={b.id} value={b.handle}>{b.display_name}{b.relationship ? ` · ${b.relationship}` : ''}</option>)}
                </select>
              )}
              {release?.released && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-medium text-sage-600" title="Your legacy policy releases letters to this person">
                  ✓ Can receive letters{release.version ? ` · policy v${release.version}` : ''}
                </span>
              )}
            </Row>
          )}
          {isLetter && release && !release.released && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold-500/30 bg-[#FBF0D9] px-5 py-3 text-sm text-bark-600 sm:px-6">
              <span className="min-w-0 flex-1">Your legacy policy doesn't release letters to {recipientName} yet, so {recipientName} would never receive this letter.</span>
              <button type="button" onClick={addRelease} disabled={addingRelease} className="btn-secondary py-1.5 text-sm">
                {addingRelease ? 'Adding…' : 'Add to my policy'}
              </button>
            </div>
          )}
          <Row label="Subject" htmlFor="subject">
            <input id="subject" className={`${bare} text-lg font-semibold`} placeholder={isLetter ? 'For example: To my daughter' : 'A title, if you like'}
              value={form.title} onChange={set('title')} maxLength={200} />
          </Row>
          <Row label="Date" htmlFor="date" error={futureDate ? 'This date is in the future. Choose today or an earlier day.' : ''}>
            <input id="date" type="date" required max={today()} value={form.entry_date} onChange={set('entry_date')} className={`${bare} flex-none text-sm`} />
            <span className="text-xs text-ink-400">{isLetter ? 'the day you wrote it' : 'the day this memory happened'}</span>
          </Row>
          {isLetter && (
            <Row label="Opens" error={noRelease ? 'Choose at least one: after your death, or a date.' : ''}>
              <label className="flex items-center gap-2 text-sm text-ink-600"><input type="checkbox" className="checkbox" checked={form.release_on_death} onChange={set('release_on_death')} /> After my death</label>
              <span className="text-xs text-ink-400">and/or on</span>
              <input type="date" min={today()} value={form.release_on} onChange={set('release_on')} aria-label="Opens on a date (optional)"
                className="rounded-lg border border-cream-300 bg-white/80 px-2 py-1 text-sm text-ink-700 focus:border-gold-500 focus:outline-none" />
            </Row>
          )}

          {/* Body */}
          <textarea required className="paper-lines block min-h-[380px] w-full resize-y border-0 bg-transparent px-5 py-4 text-lg text-ink-600 placeholder:text-ink-400/50 focus:outline-none sm:px-6"
            placeholder={isLetter ? 'Dear…' : 'Today I…'} value={form.text} onChange={set('text')} aria-label={isLetter ? 'Letter text' : 'Entry text'} />

          {isLetter && <div className="px-5 pb-4 sm:px-6"><LegalDisclaimer compact /></div>}

          {/* Toolbar, like an email's bottom bar: writing mode on the left, send on the right */}
          <div className="border-t border-cream-300 bg-cream-100/70 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span id="mode-label" className="sr-only">Writing mode</span>
                <div role="radiogroup" aria-labelledby="mode-label" className="inline-flex rounded-xl bg-cream-200 p-1">
                  {MODES.map((m) => (
                    <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} title={m.short}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m.key ? 'bg-white text-ink-700 shadow-paper' : 'text-ink-500 hover:text-ink-700'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}
                  className="rounded-lg px-2 py-1.5 text-sm font-medium text-bark-500 hover:bg-cream-200">
                  {showPreview ? 'Hide preview' : 'Preview'}
                </button>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-ink-400">{words} words</span>
                <button className="btn-primary px-5 py-2.5" disabled={!canSave}>
                  <NavIcon name="write" size={16} />{busy ? 'Sealing…' : isLetter ? 'Seal letter' : 'Seal entry'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-400">{current.short} Sealed pages can never be edited or deleted, only revised.</p>
            {showPreview && <div className="mt-3"><ModePreview mode={mode} text={form.text} /></div>}
          </div>
        </div>
      </form>
    </>
  )
}
