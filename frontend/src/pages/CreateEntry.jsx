import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, drafts, fmtDate, newDraftId, today, tokenStore } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, ConfirmDialog, Dialog, Field, LegalDisclaimer, PageHeader, useAsync, useToast } from '../components/ui'
import { correctAll, correctAtCaret, nameMap } from '../autocorrect'
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
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const bare = 'min-w-0 flex-1 border-0 bg-transparent p-0 text-ink-700 placeholder:text-ink-400/60 focus:outline-none focus:ring-0'

export default function CreateEntry({ modal = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const background = location.state?.background
  const toast = useToast()
  const [params] = useSearchParams()
  const initialMode = MODES.some((m) => m.key === params.get('mode')) ? params.get('mode') : user.default_writing_mode || 'verbatim'
  const blank = { title: '', text: '', entry_date: today(), kind: 'text', recipient: '', release_on: '', release_on_death: false, opens: 'date', days_after: '' }
  // ?draft=<id> continues a draft from the Drafts list; otherwise this is a new draft.
  const [draft] = useState(() => (params.get('draft') ? drafts.get(user.id, params.get('draft')) : null))
  const draftId = useRef(draft?.id || newDraftId())
  const [mode, setMode] = useState(draft?.mode || initialMode)
  const [showPreview, setShowPreview] = useState(false)
  const beneficiaries = useAsync(() => api('/api/beneficiaries'))
  // "New letter" on Diary entries opens the composer with ?kind=letter (a draft keeps its text either way).
  const kindParam = params.get('kind') === 'letter' ? 'letter' : params.get('kind') === 'text' ? 'text' : null
  const [form, setForm] = useState(() => {
    const start = draft ? { ...blank, ...draft.form } : blank
    return kindParam ? { ...start, kind: kindParam } : start
  })
  // The tabs above change ?kind=; follow them (the first render already took it from the URL or the draft).
  const lastKindParam = useRef(kindParam)
  useEffect(() => {
    if (lastKindParam.current === kindParam) return
    lastKindParam.current = kindParam
    const want = kindParam || 'text'
    setForm((f) => (f.kind === want ? f : { ...f, kind: want }))
  }, [kindParam])
  const [restored, setRestored] = useState(!!draft)
  const [draftSaved, setDraftSaved] = useState(null)   // time the draft was last stored on this device
  const [confirming, setConfirming] = useState(false)   // final check before the permanent save
  // Automatic spelling and grammar correction while typing (on by default, remembered per browser).
  const [autoFix, setAutoFix] = useState(() => { try { return localStorage.getItem('mmk.autocorrect') !== 'off' } catch { return true } })
  const [lastFix, setLastFix] = useState(null)   // { from, to, before } for the Undo link
  const textRef = useRef(null)
  const caretRef = useRef(null)
  const toggleAutoFix = () => setAutoFix((on) => { try { localStorage.setItem('mmk.autocorrect', on ? 'off' : 'on') } catch { /* private mode */ } return !on })
  useEffect(() => {  // put the cursor back where it belongs after a correction
    if (caretRef.current != null && textRef.current) { textRef.current.setSelectionRange(caretRef.current, caretRef.current); caretRef.current = null }
  }, [form.text])
  const onText = (e) => {
    const value = e.target.value
    const caret = e.target.selectionStart
    const typing = e.nativeEvent?.inputType === 'insertText' || e.nativeEvent?.inputType === 'insertLineBreak'
    if (autoFix && typing && caret === e.target.selectionEnd) {
      const r = correctAtCaret(value, caret, names)
      if (r) {
        setLastFix({ ...r.fix, before: value, caret })
        caretRef.current = r.caret
        setForm({ ...form, text: r.text })
        return
      }
    }
    if (lastFix && !typing) setLastFix(null)
    setForm({ ...form, text: value })
  }
  const undoFix = () => { if (!lastFix) return; caretRef.current = lastFix.caret; setForm({ ...form, text: lastFix.before }); setLastFix(null); textRef.current?.focus() }
  const [release, setRelease] = useState(null)   // does the policy release letters to the chosen recipient?
  const [addingRelease, setAddingRelease] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const active = (beneficiaries.data || []).filter((b) => b.active)
  const names = nameMap(beneficiaries.data)
  const current = MODES.find((m) => m.key === mode)
  const hasContent = !!(form.text.trim() || form.title.trim())

  // Save the draft as the person types; drop it once the page is empty.
  useEffect(() => {
    const t = setTimeout(() => {
      if (hasContent) {
        try { drafts.put(user.id, { id: draftId.current, form, mode }); setDraftSaved(new Date()) }
        catch { setDraftSaved('failed') }
      } else { drafts.remove(user.id, draftId.current); setDraftSaved(null) }
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
  // Leave the page but keep the writing: it waits under Drafts in All entries.
  const saveDraft = () => {
    try { drafts.put(user.id, { id: draftId.current, form, mode }) } catch { setDraftSaved('failed'); setError("Your draft couldn't be saved on this device. Copy your text before you leave."); return }
    toast('Saved to Drafts. You can finish it any time.')
    if (modal && background) navigate(background.pathname + (background.search || ''), { replace: true, state: { draftSaved: true } })
    else navigate('/entries?kind=draft', { state: { draftSaved: true } })
  }
  // Floating window: X or Escape closes it. Any writing is kept under Drafts, so nothing is lost.
  const close = () => {
    if (hasContent) { saveDraft(); return }
    drafts.remove(user.id, draftId.current)
    navigate(background.pathname + (background.search || ''), { replace: true })
  }
  const closeRef = useRef(close)
  closeRef.current = close

  // Keyboard: Ctrl/Cmd+S opens the final check.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (canSaveRef.current) document.getElementById('composer')?.requestSubmit() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])
  useEffect(() => {
    if (!modal) return undefined
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ;(form.kind === 'letter' ? document.querySelector('#composer select') : textRef.current)?.focus()
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog][aria-labelledby=dialog-title]')) { e.preventDefault(); closeRef.current() } }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey) }
  }, [modal]) // eslint-disable-line react-hooks/exhaustive-deps
  const canSaveRef = useRef(false)
  const recipientName = active.find((b) => b.handle === form.recipient)?.display_name || form.recipient

  if (user.death_triggered_at) return <Alert kind="warn">The vault is sealed; new entries cannot be written.</Alert>

  // The form's Save opens the final check; only "Save permanently" stores the entry.
  const askToSave = (e) => {
    e.preventDefault()
    if (!canSave) return
    if (autoFix) {  // pasted text was not corrected while typing: correct the whole text now (shown in the check)
      const fixedText = correctAll(form.text, names)
      const fixedTitle = form.title.trim() ? correctAll(form.title, names) : form.title
      if (fixedText !== form.text || fixedTitle !== form.title) setForm({ ...form, text: fixedText, title: fixedTitle })
    }
    setConfirming(true)
  }
  const submit = async () => {
    if (busy) return  // no double saves
    setBusy(true); setError('')
    try {
      // The date is always today (in this device's time zone); letters are sent as written.
      const body = { title: form.title, text: form.text, entry_date: today(), mode: form.kind === 'letter' ? 'verbatim' : mode, kind: form.kind }
      if (form.kind === 'letter') Object.assign(body, form.opens === 'death'
        ? { recipient: form.recipient, release_on: null, release_on_death: true, deliver_while_alive: false,
            release_days_after_death: Number(form.days_after) > 0 ? Number(form.days_after) : null }
        : { recipient: form.recipient, release_on: form.release_on || null, release_on_death: false, deliver_while_alive: true })
      const res = await api('/api/entries', { method: 'POST', body })
      drafts.remove(user.id, draftId.current)
      navigate(`/entries/${res.entry.id}`, { replace: modal, state: { justCreated: true, delivery: res.delivery } })
    } catch (err) {
      setError(err.status ? err.message : "Can't connect to MMK. Check your internet connection and try again. Your draft is still on this device.")
      setBusy(false)
    }
  }

  const isLetter = form.kind === 'letter'
  const opensOnDate = (form.opens || 'date') === 'date'
  const pastOpen = isLetter && opensOnDate && form.release_on && form.release_on < today()
  const noRelease = isLetter && opensOnDate && (!form.release_on || pastOpen)
  const noRecipient = isLetter && !form.recipient
  const canSave = !busy && !!form.text.trim() && !noRelease && !noRecipient
  const words = form.text.trim() ? form.text.trim().split(/\s+/).length : 0
  const chars = form.text.length
  const minutes = Math.max(1, Math.round(words / 200))
  canSaveRef.current = canSave
  const saveHint = !form.text.trim() ? 'Write something first.' : noRecipient ? 'Choose a recipient.'
    : noRelease ? 'Choose when the letter is delivered.' : ''


  const heading = isLetter ? 'New letter' : 'New diary'
  const composer = (
    <>
      <form id="composer" onSubmit={askToSave}>
        <div className="card overflow-hidden p-0">
          {/* Window bar: what you are writing, and the draft status */}


          {error && <div className="px-5 pt-4 sm:px-6"><Alert>{error}</Alert></div>}

          {/* Header rows, like an email: To / Subject / Date / Opens */}
          {isLetter && (
            /* To and Opens side by side, so a letter has the same height as an entry */
            <div className="grid border-b border-cream-300 lg:grid-cols-2">
              <div className="flex min-h-[3.5rem] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6">
                <label htmlFor="to" className="w-16 shrink-0 text-sm text-ink-400">To</label>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
              {active.length === 0 ? (
                <span className="text-sm text-bark-600">No beneficiaries yet. <Link className="underline" to="/beneficiaries">Add one</Link></span>
              ) : (
                <select id="to" required value={form.recipient} onChange={set('recipient')} className={`${bare} cursor-pointer appearance-none`}>
                  <option value="">Choose a recipient…</option>
                  {active.map((b) => <option key={b.id} value={b.handle}>{b.display_name}{b.relationship ? ` · ${b.relationship}` : ''}</option>)}
                </select>
              )}
              {!opensOnDate && release?.released && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-0.5 text-xs font-medium text-sage-600" title="Allowed in your legacy policy">
                  ✓ Can receive letters
                </span>
              )}
            </div>
              </div>
              <div className="border-t border-cream-300 px-5 py-2.5 sm:px-6 lg:border-l lg:border-t-0">
                <div className="flex min-h-[2.25rem] flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-16 shrink-0 text-sm text-ink-400">Deliver</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input type="radio" name="opens" checked={opensOnDate} onChange={() => setForm({ ...form, opens: 'date' })} /> On a date
                  <input type="date" min={today()} value={form.release_on} aria-label="Delivery date"
                    onChange={(e) => setForm({ ...form, opens: 'date', release_on: e.target.value })}
                    className="rounded-lg border border-cream-300 bg-white/80 px-2 py-1 text-sm text-ink-700 focus:border-gold-500 focus:outline-none" />
                </label>
                {opensOnDate && <button type="button" className="text-xs font-medium text-bark-500 hover:underline" onClick={() => setForm({ ...form, opens: 'date', release_on: today() })}>Today</button>}
                <label className="flex items-center gap-2 text-sm text-ink-600">
                  <input type="radio" name="opens" checked={!opensOnDate} onChange={() => setForm({ ...form, opens: 'death' })} /> After my passing
                </label>
                {!opensOnDate && (
                  <label className="flex items-center gap-2 text-sm text-ink-600">
                    <input type="number" min="0" max="36500" inputMode="numeric" value={form.days_after} placeholder="0" aria-label="Days after my passing"
                      onChange={(e) => setForm({ ...form, days_after: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                      className="w-20 rounded-lg border border-cream-300 bg-white/80 px-2 py-1 text-sm text-ink-700 focus:border-gold-500 focus:outline-none" />
                    days after
                  </label>
                )}
              </div>
            </div>
                </div>
                {pastOpen && <p className="mt-1 text-xs text-rose-600" role="alert">The date can’t be in the past.</p>}
              </div>
            </div>
          )}
          {isLetter && !opensOnDate && release && !release.released && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold-500/30 bg-[#FBF0D9] px-5 py-3 text-sm text-bark-600 sm:px-6">
              <span className="min-w-0 flex-1">{recipientName} can't receive letters yet. Add them to your legacy policy.</span>
              <button type="button" onClick={addRelease} disabled={addingRelease} className="btn-secondary">
                {addingRelease ? 'Adding…' : 'Add to policy'}
              </button>
            </div>
          )}
          <Row label="Title" htmlFor="subject">
            <input id="subject" className={`${bare} text-lg font-semibold`} placeholder={isLetter ? 'Letter title' : 'Entry title (optional)'}
              value={form.title} onChange={set('title')} maxLength={200} />
          </Row>

          {/* Body */}
          <textarea required className={`paper-lines block w-full resize-y border-0 bg-transparent px-5 py-4 text-lg text-ink-600 ${modal ? (isLetter ? 'min-h-[260px] sm:min-h-[40vh]' : 'min-h-[320px] sm:min-h-[48vh]') : isLetter ? 'min-h-[386px] lg:min-h-[443px]' : 'min-h-[500px]'} placeholder:text-ink-400/50 focus:outline-none sm:px-6`}
            placeholder={isLetter ? 'Dear…' : 'Write about your day…'} value={form.text} onChange={onText} ref={textRef} spellCheck autoCorrect="on" autoCapitalize="sentences"
            aria-label={isLetter ? 'Letter text' : 'Entry text'} aria-describedby="autofix-status" />
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-2 text-xs text-ink-400 sm:px-6">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" className="checkbox" checked={autoFix} onChange={toggleAutoFix} /> Auto-correct
            </label>
            <span id="autofix-status" aria-live="polite">
              {lastFix && <>Corrected {lastFix.from === lastFix.to ? 'spacing' : <>“{lastFix.from}” → “{lastFix.to}”</>} · <button type="button" onClick={undoFix} className="font-medium text-bark-500 hover:underline">Undo</button></>}
            </span>
          </div>


          {/* Toolbar, like an email's bottom bar: writing mode on the left, send on the right */}
          <div className="border-t border-cream-300 bg-cream-100/70 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {isLetter ? <p className="text-xs text-ink-400" title="This letter is a personal message. It has no legal effect."><b className="font-semibold text-ink-500">Not a legal will.</b> It has no legal effect.</p> : <div className="flex flex-wrap items-center gap-2">
                <span id="mode-label" className="sr-only">Writing mode</span>
                <div role="radiogroup" aria-labelledby="mode-label" className="inline-flex h-[42px] rounded-xl border border-cream-300 bg-cream-100 p-1">
                  {MODES.map((m) => (
                    <button key={m.key} type="button" role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)} title={m.short}
                      className={`rounded-lg px-3 text-sm font-medium transition ${mode === m.key ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200 hover:text-ink-700'}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setShowPreview(!showPreview)} aria-expanded={showPreview}
                  className="btn-ghost px-3 text-bark-500">
                  {showPreview ? 'Hide preview' : 'Preview'}
                </button>
              </div>}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                <span className="text-xs text-ink-400" title={`${chars} characters · ${minutes} min read`} aria-live="polite">
                  {words} word{words === 1 ? '' : 's'}
                  {draftSaved === 'failed' ? <span className="text-rose-600"> · draft not saved</span>
                    : draftSaved ? <> · saved {clock(draftSaved)}</> : restored ? ' · draft restored' : ''}
                </span>
                <button type="button" className="btn-secondary" disabled={busy || (!modal && !hasContent)} onClick={modal ? close : saveDraft} title={hasContent ? 'Close it; it waits under Drafts' : 'Close'}>Discard</button>
                <button className="btn-primary px-5" disabled={!canSave} aria-describedby={saveHint ? 'save-hint' : undefined} title={`${isLetter ? 'Send letter' : 'Save entry'} (Ctrl+S)`}>
                  <NavIcon name={isLetter ? 'send' : 'write'} size={16} />{busy ? (isLetter ? 'Sending…' : 'Saving…') : (isLetter ? 'Send letter' : 'Save entry')}
                </button>
              </div>
            </div>
            {saveHint && form.text.trim() && <p id="save-hint" className="mt-2 text-xs text-rose-600">{saveHint}</p>}
            {!isLetter && showPreview && <div className="mt-3"><ModePreview mode={mode} text={form.text} /></div>}
          </div>
        </div>
      </form>


      <Dialog open={confirming} wide title={isLetter ? 'Send this letter?' : 'Save this entry?'} onClose={busy ? undefined : () => setConfirming(false)}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep editing</button>
          <button type="button" data-autofocus className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? (isLetter ? 'Sending…' : 'Saving…') : error ? 'Try again' : isLetter ? 'Send letter' : 'Save permanently'}
          </button>
        </>}>
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        <dl className="mb-4 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
          {isLetter && <><dt className="text-ink-400">To</dt><dd>{recipientName}</dd></>}
          <dt className="text-ink-400">Title</dt><dd>{form.title.trim() || <span className="text-ink-400">No title</span>}</dd>
          {isLetter && <><dt className="text-ink-400">Delivery</dt><dd>{opensOnDate ? (form.release_on === today() ? 'Today, as soon as you send it' : fmtDate(form.release_on)) : Number(form.days_after) > 0 ? `${form.days_after} days after your passing` : 'After your passing'}</dd></>}
          {!isLetter && <><dt className="text-ink-400">Mode</dt><dd>{current.label}</dd></>}
          <dt className="text-ink-400">Length</dt><dd>{words} words</dd>
        </dl>
        <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-cream-300 bg-white/70 p-4 text-ink-600">{form.text}</div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-500">
          <li>{isLetter ? 'Once sent, the letter cannot be edited or taken back.' : 'The original is kept exactly as written and cannot be edited or deleted later. You can add revisions; the original stays.'}</li>
          {!isLetter && mode === 'light_fix' && <li>Light Fix stores its small corrections as a separate revision. Your original stays as written.</li>}
          {!isLetter && mode === 'review' && <li>Review suggestions appear on the entry page. You choose which to keep; nothing changes without you.</li>}
          {isLetter && opensOnDate && <li>{recipientName} gets an email and can read the letter on their MMK home page {form.release_on === today() ? 'right away' : `on ${fmtDate(form.release_on)}`}.</li>}
        </ul>
      </Dialog>
    </>
  )

  if (!modal) {
    return (
      <>
        <h1 className="sr-only">Entry</h1>
        <h2 className="mb-4 text-3xl font-semibold leading-tight">{heading}</h2>
        {composer}
      </>
    )
  }
  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-ink-700/40 backdrop-blur-[2px] sm:items-center sm:p-6 fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="composer-title"
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden bg-cream-100 shadow-paper sm:max-h-[94vh] sm:max-w-5xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-cream-300 px-4 py-3 sm:px-6">
          <h2 id="composer-title" className="flex items-center gap-2.5 text-lg font-semibold">
            <span className="text-bark-500"><NavIcon name={isLetter ? 'letters' : 'write'} size={18} /></span>{heading}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">{composer}</div>
      </div>
    </div>
  )
}
