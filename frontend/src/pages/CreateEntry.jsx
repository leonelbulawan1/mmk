import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, draftStore, fmtDate, today, tokenStore } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, Dialog, Field, LegalDisclaimer, PageHeader, useAsync } from '../components/ui'
import NavIcon from '../components/NavIcon'

const MODES = [
  { key: 'verbatim', label: 'Verbatim', short: 'Saved exactly as you type it.' },
  { key: 'light_fix', label: 'Light Fix', short: 'Fixes small typos. Your original is kept.' },
  { key: 'review', label: 'Review', short: 'Shows suggested fixes after you save. You choose what to keep.' },
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
      <p className="mb-1.5 text-xs font-medium text-ink-400">{text.trim() ? 'Your text' : 'Example'}:</p>
      {preview.mode === 'verbatim' && <p className="line-clamp-4">{preview.original}</p>}
      {preview.mode === 'light_fix' && (preview.revision_text
        ? <><p className="line-clamp-4">{preview.revision_text}</p>
          <p className="pt-1.5 text-xs text-ink-400">{preview.changes.length} fix{preview.changes.length === 1 ? '' : 'es'}</p></>
        : <p className="text-ink-400">Nothing to fix.</p>)}
      {preview.mode === 'review' && (preview.suggestions.length
        ? <><div className="line-clamp-6"><DiffView ops={preview.suggestions} /></div>
          <p className="pt-1.5 text-xs text-ink-400">You can accept these after saving.</p></>
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
const SIZES = ['text-base', 'text-lg', 'text-xl', 'text-2xl']
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const bare = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-ink-700 placeholder:text-ink-400/60 focus:outline-none focus:ring-0'

export default function CreateEntry() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialMode = MODES.some((m) => m.key === params.get('mode')) ? params.get('mode') : user.default_writing_mode || 'verbatim'
  const blank = { title: '', text: '', entry_date: today(), kind: 'text', recipient: '', release_on: '', release_on_death: false, opens: 'date' }
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
  const [draftSaved, setDraftSaved] = useState(null)   // time the draft was last stored on this device
  const [confirming, setConfirming] = useState(false)   // final check before the permanent save
  const [focus, setFocus] = useState(false)             // distraction-free full-screen writing
  const [size, setSize] = useState(() => { try { return Math.min(3, Math.max(0, Number(localStorage.getItem('mmk.textsize') ?? 1))) } catch { return 1 } })
  const changeSize = (d) => setSize((n) => { const v = Math.min(3, Math.max(0, n + d)); try { localStorage.setItem('mmk.textsize', String(v)) } catch { /* private mode */ } return v })
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
      if (hasContent) {
        try { draftStore.set(user.id, { form, mode, saved_at: new Date().toISOString() }); setDraftSaved(new Date()) }
        catch { setDraftSaved('failed') }
      } else { draftStore.clear(user.id); setDraftSaved(null) }
    }, 800)
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
    if (form.kind !== 'letter' || !form.recipient || form.opens !== 'death') return
    let live = true
    api(`/api/policy/letter-release/${encodeURIComponent(form.recipient)}`)
      .then((r) => live && setRelease(r)).catch(() => {})
    return () => { live = false }
  }, [form.kind, form.recipient, form.opens])

  const addRelease = async () => {
    setAddingRelease(true); setError('')
    try { setRelease(await api(`/api/policy/letter-release/${encodeURIComponent(form.recipient)}`, { method: 'POST' })) }
    catch (err) { setError(err.message) }
    setAddingRelease(false)
  }
  const discardDraft = () => { draftStore.clear(user.id); setForm(blank); setRestored(false); setDraftSaved(null) }

  // Keyboard: Ctrl/Cmd+S opens the final check; Esc leaves focus mode.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canSaveRef.current) setConfirming(true) }
      else if (e.key === 'Escape' && focus && !confirming) setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, confirming])
  const canSaveRef = useRef(false)
  const recipientName = active.find((b) => b.handle === form.recipient)?.display_name || form.recipient

  if (user.death_triggered_at) return <Alert kind="warn">The vault is sealed; new entries cannot be written.</Alert>

  // The form's Save opens the final check; only "Save permanently" stores the entry.
  const askToSave = (e) => { e.preventDefault(); if (canSave) setConfirming(true) }
  const submit = async () => {
    if (busy) return  // no double saves
    setBusy(true); setError('')
    try {
      const body = { title: form.title, text: form.text, entry_date: form.entry_date, mode, kind: form.kind }
      if (form.kind === 'letter') Object.assign(body, form.opens === 'death'
        ? { recipient: form.recipient, release_on: null, release_on_death: true, deliver_while_alive: false }
        : { recipient: form.recipient, release_on: form.release_on || null, release_on_death: false, deliver_while_alive: true })
      const res = await api('/api/entries', { method: 'POST', body })
      draftStore.clear(user.id)
      navigate(`/entries/${res.entry.id}`, { state: { justCreated: true, delivery: res.delivery } })
    } catch (err) {
      setError(err.status ? err.message : 'Could not reach MMK. Check your connection; your draft is still on this device.')
      setBusy(false)
    }
  }

  const isLetter = form.kind === 'letter'
  const futureDate = form.entry_date > today()
  const opensOnDate = (form.opens || 'date') === 'date'
  const pastOpen = isLetter && opensOnDate && form.release_on && form.release_on < today()
  const noRelease = isLetter && opensOnDate && (!form.release_on || pastOpen)
  const noRecipient = isLetter && !form.recipient
  const canSave = !busy && !!form.text.trim() && !futureDate && !noRelease && !noRecipient
  const setKind = (kind) => setForm({ ...form, kind })
  const words = form.text.trim() ? form.text.trim().split(/\s+/).length : 0
  const chars = form.text.length
  const minutes = Math.max(1, Math.round(words / 200))
  canSaveRef.current = canSave
  const saveHint = !form.text.trim() ? 'Write something first.' : noRecipient ? 'Choose who the letter is for.'
    : futureDate ? 'The date can’t be in the future.' : noRelease ? 'Choose when the letter opens.' : ''


  return (
    <>
      <PageHeader title={isLetter ? 'New letter' : 'New entry'} />
      <form onSubmit={askToSave} className={focus ? 'fixed inset-0 z-40 overflow-y-auto bg-cream-50 px-2 py-4 sm:px-6 sm:py-8' : 'mx-auto max-w-4xl'}>
        <div className={`card overflow-hidden p-0 ${focus ? 'mx-auto max-w-3xl' : ''}`}>
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
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-400" aria-live="polite">
                {draftSaved === 'failed' ? <span className="text-rose-600">Draft not saved: this browser blocked storage</span>
                  : draftSaved ? <>Draft saved on this device · {clock(draftSaved)}</> : restored ? 'Draft restored' : 'Not saved yet'}
                {restored && <> · <button type="button" onClick={discardDraft} className="font-medium text-bark-500 hover:underline">Discard draft</button></>}
              </span>
              <button type="button" onClick={() => setFocus(!focus)} aria-pressed={focus} title={focus ? 'Leave focus mode (Esc)' : 'Focus mode'}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink-500 hover:bg-cream-200">
                <NavIcon name={focus ? 'close' : 'focus'} size={15} />{focus ? 'Exit focus' : 'Focus'}
              </button>
            </div>
          </div>

          {error && <div className="px-5 pt-4 sm:px-6"><Alert>{error}</Alert></div>}

          {/* Header rows, like an email: To / Subject / Date / Opens */}
          {isLetter && (
            <Row label="To" htmlFor="to">
              {active.length === 0 ? (
                <span className="text-sm text-bark-600">No beneficiaries yet. <Link className="underline" to="/beneficiaries">Add one</Link></span>
              ) : (
                <select id="to" required value={form.recipient} onChange={set('recipient')} className={`${bare} cursor-pointer appearance-none`}>
                  <option value="">Choose a beneficiary…</option>
                  {active.map((b) => <option key={b.id} value={b.handle}>{b.display_name}{b.relationship ? ` · ${b.relationship}` : ''}</option>)}
                </select>
              )}
              {!opensOnDate && release?.released && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-medium text-sage-600" title="Allowed in your legacy policy">
                  ✓ Can receive letters
                </span>
              )}
            </Row>
          )}
          {isLetter && !opensOnDate && release && !release.released && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold-500/30 bg-[#FBF0D9] px-5 py-3 text-sm text-bark-600 sm:px-6">
              <span className="min-w-0 flex-1">{recipientName} can't receive letters yet. Add them to your legacy policy.</span>
              <button type="button" onClick={addRelease} disabled={addingRelease} className="btn-secondary py-1.5 text-sm">
                {addingRelease ? 'Adding…' : 'Add to policy'}
              </button>
            </div>
          )}
          <Row label="Subject" htmlFor="subject">
            <input id="subject" className={`${bare} text-lg font-semibold`} placeholder={isLetter ? 'Title' : 'Title (optional)'}
              value={form.title} onChange={set('title')} maxLength={200} />
          </Row>
          <Row label="Date" htmlFor="date" error={futureDate ? 'Date can’t be in the future.' : ''}>
            <input id="date" type="date" required max={today()} value={form.entry_date} onChange={set('entry_date')} className={`${bare} flex-none text-sm`} />
          </Row>
          {isLetter && (
            <Row label="Opens" error={pastOpen ? 'The opening date can’t be in the past.' : noRelease ? 'Choose the date the letter opens.' : ''}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input type="radio" name="opens" checked={opensOnDate} onChange={() => setForm({ ...form, opens: 'date' })} /> On
                  <input type="date" min={today()} value={form.release_on} aria-label="Opening date"
                    onChange={(e) => setForm({ ...form, opens: 'date', release_on: e.target.value })}
                    className="rounded-lg border border-cream-300 bg-white/80 px-2 py-1 text-sm text-ink-700 focus:border-gold-500 focus:outline-none" />
                </label>
                {opensOnDate && <button type="button" className="text-xs font-medium text-bark-500 hover:underline" onClick={() => setForm({ ...form, opens: 'date', release_on: today() })}>Today</button>}
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input type="radio" name="opens" checked={!opensOnDate} onChange={() => setForm({ ...form, opens: 'death' })} /> After my death
                </label>
              </div>
            </Row>
          )}
          {isLetter && form.recipient && (
            <p className="border-b border-cream-200 px-5 py-2 text-xs text-ink-400 sm:px-6">
              {opensOnDate
                ? (form.release_on === today()
                  ? <>{recipientName} gets it as soon as you save: an email, and the letter on their MMK home page.</>
                  : form.release_on ? <>On {fmtDate(form.release_on)}, {recipientName} gets an email and the letter appears on their MMK home page.</> : null)
                : <>{recipientName} can read it only after your death, as your legacy policy allows.</>}
            </p>
          )}

          {/* Body */}
          <div className="flex items-center justify-end gap-1 px-4 pt-2 text-ink-400" role="group" aria-label="Text size">
            <button type="button" onClick={() => changeSize(-1)} disabled={size === 0} className="h-8 w-8 rounded-lg text-xs hover:bg-cream-200 disabled:opacity-40" aria-label="Smaller text">A−</button>
            <button type="button" onClick={() => changeSize(1)} disabled={size === 3} className="h-8 w-8 rounded-lg text-sm hover:bg-cream-200 disabled:opacity-40" aria-label="Larger text">A+</button>
          </div>
          <textarea required className={`paper-lines block w-full resize-y border-0 bg-transparent px-5 py-4 ${SIZES[size]} text-ink-600 ${focus ? 'min-h-[65vh]' : 'min-h-[380px]'} placeholder:text-ink-400/50 focus:outline-none sm:px-6`}
            placeholder={isLetter ? 'Dear…' : 'Start writing…'} value={form.text} onChange={set('text')} aria-label={isLetter ? 'Letter text' : 'Entry text'} />

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
                <span className="text-xs text-ink-400" title={`${chars} characters`}>
                  {words} word{words === 1 ? '' : 's'} · {chars} characters{words ? ` · ${minutes} min read` : ''}
                </span>
                <button className="btn-primary px-5 py-2.5" disabled={!canSave} aria-describedby={saveHint ? 'save-hint' : undefined} title="Save (Ctrl+S)">
                  <NavIcon name="write" size={16} />{busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {saveHint && form.text.trim() && <p id="save-hint" className="mt-2 text-xs text-rose-600">{saveHint}</p>}
            <p className="mt-2 text-xs text-ink-400">{current.short} Drafts stay on this device until you save. Saved entries can’t be edited or deleted, only revised. Light Fix and Review run on the MMK server; your writing is not sent to an outside AI service.</p>
            {showPreview && <div className="mt-3"><ModePreview mode={mode} text={form.text} /></div>}
          </div>
        </div>
      </form>

      <Dialog open={confirming} wide title={isLetter ? 'Save this letter?' : 'Save this entry?'} onClose={busy ? undefined : () => setConfirming(false)}
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep editing</button>
          <button type="button" data-autofocus className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : error ? 'Try again' : 'Save permanently'}
          </button>
        </>}>
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        <dl className="mb-4 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
          {isLetter && <><dt className="text-ink-400">To</dt><dd>{recipientName}</dd></>}
          <dt className="text-ink-400">Title</dt><dd>{form.title.trim() || <span className="text-ink-400">No title</span>}</dd>
          <dt className="text-ink-400">Date</dt><dd>{fmtDate(form.entry_date)}</dd>
          {isLetter && <><dt className="text-ink-400">Opens</dt><dd>{opensOnDate ? (form.release_on === today() ? 'Today, as soon as you save' : fmtDate(form.release_on)) : 'After your death'}</dd></>}
          <dt className="text-ink-400">Mode</dt><dd>{current.label}</dd>
          <dt className="text-ink-400">Length</dt><dd>{words} words</dd>
        </dl>
        <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-cream-300 bg-white/70 p-4 text-ink-600">{form.text}</div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-500">
          <li>The original is kept exactly as written and cannot be edited or deleted later. You can add revisions; the original stays.</li>
          {mode === 'light_fix' && <li>Light Fix stores its small corrections as a separate revision. Your original stays as written.</li>}
          {mode === 'review' && <li>Review suggestions appear on the entry page. You choose which to keep; nothing changes without you.</li>}
          {isLetter && opensOnDate && <li>{recipientName} gets an email and can read the letter on their MMK home page {form.release_on === today() ? 'right away' : `on ${fmtDate(form.release_on)}`}.</li>}
        </ul>
      </Dialog>
    </>
  )
}
