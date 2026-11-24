import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { fmtDate } from '../api'
import { Alert, ConfirmDialog, Dialog, Spinner, Tag, useAsync, useToast } from './ui'
import NavIcon from './NavIcon'

// Shared by the Entry page and the Dashboard.
const firstWords = (t, n = 7) => { const w = (t || '').split(/\s+/).filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '…' : '') }
export const entryTitle = (e) => e.title?.trim() || firstWords(e.current_text || e.snippet) || 'Untitled'
const day = (iso) => new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
// The saved time, only when it was saved on the entry's own date.
const sameDay = (iso, day) => !!iso && new Date(iso).toLocaleDateString('en-CA') === day
const MODE = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

const Actions = ({ onDelete, onClose, onEdit, editLabel = 'Edit' }) => (
  <>
    <button type="button" className="btn-danger-outline mr-auto" onClick={onDelete}><NavIcon name="trash" size={16} />Delete</button>
    <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
    <button type="button" data-autofocus className="btn-primary" onClick={onEdit}><NavIcon name="edit" size={16} />{editLabel}</button>
  </>
)

// A diary entry: date and time, the full text, themes and people; Edit and Delete.
// Edit happens in the same window (saved as a revision; the original stays in the vault).
// Delete adds a "deleted" record to the vault: the entry is hidden everywhere and shared with no one.
export function EntryModal({ entry, onClose, onDeleted, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [editError, setEditError] = useState('')
  const [confirmDiscard, setConfirmDiscard] = useState(null)  // null, 'view' (back to the entry) or 'close'
  const full = useAsync(() => (entry ? api(`/api/entries/${entry.id}`) : Promise.resolve(null)), [entry?.id])
  useEffect(() => { setEditing(false); setEditError('') }, [entry?.id])
  if (!entry) return null
  const e = full.data || entry
  const sealed = !!user.death_triggered_at
  const edits = e.revision_history?.length || 0
  const remove = async () => {
    setBusy(true)
    try { await api(`/api/entries/${e.id}`, { method: 'DELETE' }); setConfirm(false); toast('Entry deleted.'); onDeleted?.(e.id) }
    catch (err) { setConfirm(false); toast(err.message, 'error') } finally { setBusy(false) }
  }
  const changed = editing && text !== (e.current_text || '')
  const startEdit = () => { setText(e.current_text || ''); setEditError(''); setEditing(true) }
  const stopEdit = () => { setEditing(false); setConfirmDiscard(null); setEditError('') }
  const save = async () => {
    if (!text.trim()) { setEditError('Write something before saving.'); return }
    setBusy(true); setEditError('')
    try {
      const updated = await api(`/api/entries/${e.id}/revisions`, { method: 'POST', body: { text, source: e.pending_review ? 'review' : 'edit' } })
      full.setData(updated); setEditing(false); toast('Changes saved.'); onSaved?.(updated)
    } catch (err) { setEditError(err.message) } finally { setBusy(false) }
  }
  // Closing with unsaved changes asks first.
  const close = () => (changed ? setConfirmDiscard('close') : onClose())
  return (
    <>
      <Dialog open={!confirm && !confirmDiscard} wide onClose={busy ? undefined : close} eyebrow={editing ? 'Edit diary entry' : 'Diary entry'} title={entryTitle(e)}
        meta={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{day(e.entry_date)}</span>{sameDay(e.created_at, e.entry_date) && <><span aria-hidden>·</span><span>{time(e.created_at)}</span></>}
          {e.writing_mode && <><span aria-hidden>·</span><span>{MODE[e.writing_mode]}</span></>}
          {edits > 0 && <><span aria-hidden>·</span><span>Edited {edits} time{edits > 1 ? 's' : ''}</span></>}
        </span>}
        footer={sealed ? <button type="button" data-autofocus className="btn-secondary" onClick={onClose}>Close</button>
          : editing ? <>
            <span className="mr-auto self-center text-xs text-ink-400">{text.trim().split(/\s+/).filter(Boolean).length} words</span>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => (changed ? setConfirmDiscard('view') : stopEdit())}>Cancel</button>
            <button type="button" className="btn-primary" disabled={busy || !changed} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
          </>
          : <Actions onClose={onClose} onDelete={() => setConfirm(true)} onEdit={startEdit} />}>
        {full.loading ? <Spinner label="Loading entry" /> : full.error ? <Alert>{full.error}</Alert> : editing ? (
          <div className="space-y-3">
            {editError && <Alert onClose={() => setEditError('')}>{editError}</Alert>}
            <textarea data-autofocus className="input paper-lines min-h-[45vh] resize-y text-lg" value={text} onChange={(ev) => setText(ev.target.value)}
              aria-label="Entry text" maxLength={20000} />
          </div>
        ) : (
          <>
            <div className="max-w-2xl whitespace-pre-wrap text-lg leading-[1.8] text-ink-600">{e.current_text}</div>
            {(e.topics?.length > 0 || e.names?.length > 0) && (
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                {e.topics?.length > 0 && <span className="flex flex-wrap items-center gap-1.5"><span className="text-ink-400">Themes</span>{e.topics.map((t) => <Tag key={t} tone="bark">{t}</Tag>)}</span>}
                {e.names?.length > 0 && <span className="flex flex-wrap items-center gap-1.5"><span className="text-ink-400">People</span>{e.names.map((n) => <Tag key={n}>{n}</Tag>)}</span>}
              </div>
            )}
          </>
        )}
      </Dialog>
      <ConfirmDialog open={!!confirmDiscard} title="Discard changes?" confirmLabel="Discard" cancelLabel="Keep editing" danger
        onConfirm={() => { const then = confirmDiscard; stopEdit(); if (then === 'close') onClose() }} onCancel={() => setConfirmDiscard(null)}>
        Your changes to “{entryTitle(e)}” won’t be saved.
      </ConfirmDialog>
      <ConfirmDialog open={confirm} danger busy={busy} title="Delete this entry?" confirmLabel="Delete entry" cancelLabel="Keep it"
        onConfirm={remove} onCancel={() => setConfirm(false)}>
        “{entryTitle(e)}” will be deleted. This can’t be undone.
      </ConfirmDialog>
    </>
  )
}

// A draft: what has been written so far and when it was saved; Edit (continue writing) and Delete.
export function DraftModal({ draft, onClose, onDelete }) {
  const navigate = useNavigate()
  const location = useLocation()
  if (!draft) return null
  const letter = draft.form.kind === 'letter'
  const saved = draft.saved_at ? new Date(draft.saved_at) : null
  const edit = () => { onClose(); navigate(`/entries/new?draft=${draft.id}${letter ? '&kind=letter' : ''}`, { state: { background: location } }) }
  return (
    <Dialog open wide onClose={onClose} eyebrow={letter ? 'Letter draft' : 'Diary draft'} title={draft.form.title?.trim() || 'Untitled'}
      meta={saved && <>Last saved {saved.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {time(draft.saved_at)}</>}
      footer={<Actions onClose={onClose} onDelete={onDelete} onEdit={edit} editLabel="Continue writing" />}>
      <div className="max-w-2xl whitespace-pre-wrap text-lg leading-[1.8] text-ink-600">{draft.form.text?.trim() || <span className="text-ink-400">Nothing written yet.</span>}</div>
    </Dialog>
  )
}

// A letter, read-only (letters can't be edited or deleted once sent): who it is for, when it is
// delivered and where it stands, then the letter itself. Same card as the letter page.
export function LetterModal({ letter, onClose }) {
  const full = useAsync(() => (letter ? api(`/api/entries/${letter.id}`) : Promise.resolve(null)), [letter?.id])
  if (!letter) return null
  const e = full.data || letter
  const d = e.delivery
  const status = d?.status === 'delivered' ? { label: 'Delivered', cls: 'bg-sage-100 text-sage-600' }
    : d?.after_death || e.release_on_death ? { label: 'Waiting', cls: 'bg-[#FBF0D9] text-bark-600' }
    : { label: 'Scheduled', cls: 'bg-[#FBF0D9] text-bark-600' }
  const delivery = e.release_on_death
    ? (e.release_days_after_death ? `${e.release_days_after_death} days after your passing` : 'After your passing')
    : e.release_on ? fmtDate(e.release_on) : ''
  return (
    <Dialog open wide onClose={onClose} eyebrow="Letter" title={entryTitle(e)}
      meta={<span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span>{day(e.entry_date)}</span>{sameDay(e.created_at, e.entry_date) && <><span aria-hidden>·</span><span>{time(e.created_at)}</span></>}</span>}
      footer={<>
        
        <button type="button" data-autofocus className="btn-secondary" onClick={onClose}>Close</button>
      </>}>
      {full.loading ? <Spinner label="Loading letter" /> : full.error ? <Alert>{full.error}</Alert> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-cream-300 bg-cream-100/60 px-4 py-3 text-sm">
            <div>
              <p className="text-ink-400">To</p>
              <p className="mt-0.5 font-semibold text-ink-700">{e.recipient_name || e.recipient}</p>
            </div>
            <div className="text-right">
              <p className="text-ink-400">Delivery</p>
              <p className="mt-0.5 inline-flex flex-wrap items-center justify-end gap-2 font-semibold text-ink-700">
                {delivery}<span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
              </p>
            </div>
          </div>
          <div className="max-w-2xl whitespace-pre-wrap text-lg leading-[1.8] text-ink-600">{e.current_text}</div>
        </>
      )}
    </Dialog>
  )
}
