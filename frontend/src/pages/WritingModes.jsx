import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import DiffView from '../components/DiffView'
import { Alert, Card, PageHeader, Spinner, useAsync } from '../components/ui'

const SAMPLE = 'today i recieved a letter from Lina , it was teh nicest surprise.'
const ICON = { verbatim: '❝', light_fix: '✧', review: '⚖' }

export default function WritingModes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const modes = useAsync(() => api('/api/writing-modes'))
  const [selected, setSelected] = useState(user.default_writing_mode || 'verbatim')
  const [sample, setSample] = useState(SAMPLE)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      if (!sample.trim()) return setPreview(null)
      api('/api/entries/preview', { method: 'POST', body: { text: sample, mode: selected } })
        .then(setPreview).catch((e) => setError(e.message))
    }, 300)
    return () => clearTimeout(t)
  }, [sample, selected])

  if (user.death_triggered_at) return <Alert kind="warn">The vault is sealed; new entries cannot be written.</Alert>
  if (modes.loading) return <Spinner />

  return (
    <>
      <PageHeader eyebrow="before you write" title="Choose a writing mode"
        subtitle="Each mode decides what happens to your words after you save. In every mode the original is stored untouched and sealed into the hash chain." />
      <Alert>{error || modes.error}</Alert>

      <div className="grid gap-4 md:grid-cols-3" role="radiogroup" aria-label="Writing mode">
        {modes.data?.map((m) => (
          <button key={m.key} role="radio" aria-checked={selected === m.key} onClick={() => setSelected(m.key)}
            className={`card p-6 text-left transition ${selected === m.key ? 'ring-2 ring-gold-500 -translate-y-0.5' : 'hover:-translate-y-0.5'}`}>
            <span className="text-4xl text-bark-500" aria-hidden>{ICON[m.key]}</span>
            <h2 className="mt-2 text-2xl font-semibold">{m.label}</h2>
            <p className="mt-2 text-sm text-ink-400">{m.description}</p>
          </button>
        ))}
      </div>

      <Card className="mt-8">
        <h2 className="text-2xl font-semibold">Try it</h2>
        <p className="mb-3 text-sm text-ink-400">Type anything to see what <b>{modes.data?.find((m) => m.key === selected)?.label}</b> would do. Nothing is saved.</p>
        <textarea className="input min-h-24 text-lg" value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Sample text" />
        {preview && (
          <div className="mt-4 rounded-xl bg-cream-100 p-4">
            {preview.mode === 'verbatim' && <p className="text-lg">{preview.original} <span className="block pt-2 text-xs text-ink-400">Kept exactly as written.</span></p>}
            {preview.mode === 'light_fix' && (preview.revision_text
              ? <><p className="text-lg">{preview.revision_text}</p><p className="pt-2 text-xs text-ink-400">Saved as a revision ({preview.changes.length} fix{preview.changes.length === 1 ? '' : 'es'}). The original stays in the vault.</p></>
              : <p className="text-sm text-ink-400">Nothing to fix.</p>)}
            {preview.mode === 'review' && (preview.suggestions.length
              ? <><DiffView ops={preview.suggestions} /><p className="pt-2 text-xs text-ink-400">You will be asked to accept these after saving.</p></>
              : <p className="text-sm text-ink-400">No suggestions.</p>)}
          </div>
        )}
      </Card>

      <div className="mt-8 flex justify-end gap-3">
        <Link to="/entries" className="btn-ghost">Cancel</Link>
        <button className="btn-primary px-6" onClick={() => navigate(`/entries/new?mode=${selected}`)}>Continue to write →</button>
      </div>
    </>
  )
}
