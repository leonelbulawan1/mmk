import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { useAuth } from '../auth'
import { Alert, Card, LevelBadge, PageHeader, useAsync } from '../components/ui'

const suggestionsFor = (first, isOwner) => [`What did ${first} love?`, 'Tell me about family trips.',
  isOwner ? 'What did I write about this person?' : 'What did the letters to me say?', `What was ${first} proud of?`]

function Answer({ text }) {
  // Turn [YYYY-MM-DD] citations into small date chips.
  const parts = text.split(/(\[\d{4}-\d{2}-\d{2}\])/g)
  return (
    <p className="whitespace-pre-wrap text-lg leading-relaxed">
      {parts.map((p, i) => /^\[\d{4}-\d{2}-\d{2}\]$/.test(p)
        ? <span key={i} className="mx-0.5 rounded-md bg-gold-400/20 px-1.5 py-0.5 font-sans text-xs text-bark-600">{fmtDate(p.slice(1, -1))}</span>
        : <span key={i}>{p}</span>)}
    </p>
  )
}

export default function Assistant() {
  const { user } = useAuth()
  const isOwner = user.role === 'owner'
  const [params, setParams] = useSearchParams()
  const info = useAsync(() => api('/api/assistant/info'))
  const bens = useAsync(() => (isOwner ? api('/api/beneficiaries') : Promise.resolve([])))
  const asHandle = isOwner ? params.get('as') || '' : user.handle
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  useEffect(() => {
    if (isOwner && !asHandle) { setMessages([]); return }
    const qs = isOwner ? `?as_handle=${asHandle}` : ''
    api(`/api/assistant/history${qs}`).then((h) => setMessages(h.flatMap((m) => [
      { role: 'user', text: m.question }, { role: 'assistant', text: m.answer, citations: m.citations }])))
      .catch((e) => setError(e.message))
  }, [asHandle, isOwner])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  const ask = async (q) => {
    const text = (q ?? question).trim()
    if (!text || busy) return
    setQuestion(''); setError(''); setBusy(true)
    setMessages((m) => [...m, { role: 'user', text }])
    try {
      const body = { question: text, ...(isOwner ? { as_handle: asHandle } : {}) }
      const res = await api('/api/assistant/ask', { method: 'POST', body })
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, citations: res.citations }])
    } catch (e) { setError(e.message); setMessages((m) => m.slice(0, -1)); setQuestion(text) } finally { setBusy(false) }
  }

  const ownerName = isOwner ? user.display_name : user.owner?.display_name
  if (!isOwner && user.owner?.allow_ai_answers === false) {
    return (
      <>
        <PageHeader title="Ask MMK" />
        <Card className="text-center text-ink-500">{ownerName} chose not to let the AI assistant answer questions about their diary. You can still read the letters and entries they shared with you.</Card>
      </>
    )
  }
  if (!isOwner && !user.owner?.death_triggered) {
    return (
      <>
        <PageHeader title="Ask MMK" />
        <Card className="text-center text-ink-500">Not available yet.</Card>
      </>
    )
  }
  return (
    <>
      <PageHeader title={isOwner ? 'AI assistant preview' : 'MMK AI Legacy Assistant'} />

      <div>
        <div className="min-w-0">
          <Card className="flex min-h-[560px] flex-col p-0">
            {isOwner && (
              <div className="flex flex-wrap items-center gap-3 border-b border-cream-300/80 px-5 py-3.5 sm:px-6">
                <label htmlFor="as" className="text-sm font-medium text-ink-600">Preview as</label>
                <select id="as" className="input w-60 py-2" value={asHandle} onChange={(e) => setParams(e.target.value ? { as: e.target.value } : {})}>
                  <option value="">Choose a beneficiary…</option>
                  {(bens.data || []).filter((b) => b.active).map((b) => <option key={b.handle} value={b.handle}>{b.display_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex-1 space-y-5 overflow-y-auto p-6" aria-live="polite">
              {messages.length === 0 && (
                <div className="py-10 text-center">
                  <p className="text-xl font-medium text-bark-500">What would you like to remember?</p>
                  {(!isOwner || asHandle) && (
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {suggestionsFor((ownerName || 'they').split(' ')[0], isOwner).map((s) => <button key={s} className="btn-secondary btn-sm" onClick={() => ask(s)}>{s}</button>)}
                    </div>
                  )}
                </div>
              )}
              {messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="flex justify-end"><p className="max-w-[80%] rounded-2xl rounded-br-md bg-ink-700 px-4 py-2.5 text-cream-50">{m.text}</p></div>
              ) : (
                <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md border border-cream-300 bg-cream-100 px-5 py-4 fade-in">
                  <Answer text={m.text} />
                  {m.citations?.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-cream-300 pt-3 text-xs text-ink-400">
                      Sources: {m.citations.map((c) => <span key={c.entry_id} className="inline-flex items-center gap-1">entry of {fmtDate(c.date)} <LevelBadge level={c.access} /></span>)}
                    </div>
                  )}
                </div>
              ))}
              {busy && <p className="text-sm text-ink-400">Searching…</p>}
              <div ref={endRef} />
            </div>
            <form className="flex gap-2 border-t border-cream-300 p-4" onSubmit={(e) => { e.preventDefault(); ask() }}>
              <input className="input flex-1" placeholder={isOwner && !asHandle ? 'Choose a beneficiary first' : 'Ask a question…'} value={question}
                disabled={isOwner && !asHandle} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} aria-label="Question" />
              <button className="btn-primary" disabled={busy || !question.trim() || (isOwner && !asHandle)}>Ask</button>
            </form>
          </Card>
          {error && <div className="mt-3"><Alert onClose={() => setError('')}>{error}</Alert></div>}
          {info.data && (
            <p className="mt-3 px-1 text-xs text-ink-400">
              {info.data.provider === 'offline' ? 'Built-in model' : `${info.data.provider} · ${info.data.model}`}
              {!info.data.configured && <span className="block text-rose-600">{info.data.error}</span>}
            </p>
          )}
        </div>

      </div>
    </>
  )
}
