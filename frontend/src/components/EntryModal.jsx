import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { Alert, ConfirmDialog, Dialog, Spinner, Tag, useAsync, useToast } from './ui'
import NavIcon from './NavIcon'

// Shared by the Entry page and the Dashboard.
const firstWords = (t, n = 7) => { const w = (t || '').split(/\s+/).filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '…' : '') }
export const entryTitle = (e) => e.title?.trim() || firstWords(e.current_text || e.snippet) || 'Untitled'
const day = (iso) => new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const MODE = { verbatim: 'Verbatim', light_fix: 'Light Fix', review: 'Review' }

const Actions = ({ onDelete, onClose, onEdit, editLabel = 'Edit' }) => (
  <>
    <button type="button" className="btn-ghost mr-auto text-rose-600 hover:bg-rose-100" onClick={onDelete}><NavIcon name="trash" size={16} />Delete</button>
    <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
    <button type="button" data-autofocus className="btn-primary" onClick={onEdit}><NavIcon name="edit" size={16} />{editLabel}</button>
  </>
)

// A diary entry: date and time, the full text, themes and people; Edit and Delete.
// Delete adds a "deleted" record to the vault: the entry is hidden everywhere and shared with no one.
export function EntryModal({ entry, onClose, onDeleted }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const full = useAsync(() => (entry ? api(`/api/entries/${entry.id}`) : Promise.resolve(null)), [entry?.id])
  if (!entry) return null
  const e = full.data || entry
  const sealed = !!user.death_triggered_at
  const edits = e.revision_history?.length || 0
  const remove = async () => {
    setBusy(true)
    try { await api(`/api/entries/${e.id}`, { method: 'DELETE' }); setConfirm(false); toast('Entry deleted.'); onDeleted?.(e.id) }
    catch (err) { setConfirm(false); toast(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <>
      <Dialog open={!confirm} wide closeButton onClose={onClose} eyebrow="Diary entry" title={entryTitle(e)}
        meta={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{day(e.entry_date)}</span><span aria-hidden>·</span><span>{time(e.created_at)}</span>
          {e.writing_mode && <><span aria-hidden>·</span><span>{MODE[e.writing_mode]}</span></>}
          {edits > 0 && <><span aria-hidden>·</span><span>Edited {edits} time{edits > 1 ? 's' : ''}</span></>}
        </span>}
        footer={sealed ? <button type="button" data-autofocus className="btn-secondary" onClick={onClose}>Close</button>
          : <Actions onClose={onClose} onDelete={() => setConfirm(true)} onEdit={() => navigate(`/entries/${e.id}`, { state: { revise: true } })} />}>
        {full.loading ? <Spinner label="Loading entry" /> : full.error ? <Alert>{full.error}</Alert> : (
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
      <ConfirmDialog open={confirm} danger busy={busy} title="Delete this entry?" confirmLabel="Delete entry" cancelLabel="Keep it"
        onConfirm={remove} onCancel={() => setConfirm(false)}>
        “{entryTitle(e)}” will be removed from your diary and never shared with anyone. This can’t be undone.
        <span className="mt-2 block text-xs text-ink-400">For the vault's integrity, a record that it was deleted stays in your vault.</span>
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
    <Dialog open wide closeButton onClose={onClose} eyebrow={letter ? 'Letter draft' : 'Diary draft'} title={draft.form.title?.trim() || 'Untitled'}
      meta={saved && <>Last saved {saved.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {time(draft.saved_at)} · only on this device</>}
      footer={<Actions onClose={onClose} onDelete={onDelete} onEdit={edit} editLabel="Continue writing" />}>
      <div className="max-w-2xl whitespace-pre-wrap text-lg leading-[1.8] text-ink-600">{draft.form.text?.trim() || <span className="text-ink-400">Nothing written yet.</span>}</div>
    </Dialog>
  )
}
