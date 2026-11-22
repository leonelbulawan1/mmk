import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { Alert, Card, PageHeader, Spinner, Tag, useAsync } from '../components/ui'

const CHEATSHEET = [
  ['group family = maria, jose;', 'Name a set of beneficiaries'],
  ['allow maria verbatim access to entries;', 'Grant a level: existence, summary or verbatim'],
  ['allow jose summary access to entries about "family" from 2015-01-01;', 'Filters: about, mentioning, from, until'],
  ['allow lina existence access to entries after 2030-01-01;', 'Release on a date…'],
  ['allow family verbatim access to entries after death;', '…or after the death trigger'],
  ['deny jose access to entries about "health";', 'Deny always wins over allow'],
  ['release letters to maria after death;', 'Open letters addressed to someone'],
]

export default function PolicyEditor() {
  const policy = useAsync(() => api('/api/policy'))
  const samples = useAsync(() => api('/api/policy/samples'))
  const [source, setSource] = useState('')
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('rules')
  const [msg, setMsg] = useState({})
  const [busy, setBusy] = useState(false)
  const [grammar, setGrammar] = useState('')
  const textRef = useRef(null)

  useEffect(() => { if (policy.data) setSource(policy.data.source) }, [policy.data])
  useEffect(() => {
    if (!policy.data) return
    const t = setTimeout(() => {
      api('/api/policy/validate', { method: 'POST', body: { source } }).then(setResult).catch((e) => setMsg({ kind: 'error', text: e.message }))
    }, 350)
    return () => clearTimeout(t)
  }, [source, policy.data])

  if (policy.loading) return <Spinner />
  if (policy.error) return <Alert>{policy.error}</Alert>
  const frozen = policy.data.frozen
  const dirty = source !== policy.data.source

  const save = async () => {
    setBusy(true); setMsg({})
    try {
      const r = await api('/api/policy', { method: 'PUT', body: { source } })
      setMsg({ kind: 'success', text: `Saved as version ${r.version}. Access decisions now follow this policy.` })
      policy.reload()
    } catch (e) { setMsg({ kind: 'error', text: e.message }) } finally { setBusy(false) }
  }
  const jumpTo = (line) => {
    const el = textRef.current
    if (!el) return
    const lines = source.split('\n')
    const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
    el.focus(); el.setSelectionRange(start, start + (lines[line - 1] || '').length)
  }
  const lineCount = source.split('\n').length

  return (
    <>
      <PageHeader eyebrow="your wishes, precisely" title="Legacy policy"
        subtitle="Write who may see what after your passing, and when. Nothing is shared while you are alive, and anything you do not allow stays private."
        actions={<>
          <Tag tone="ink">v{policy.data.version}</Tag>
          {frozen && <Tag tone="bark">Frozen</Tag>}
        </>} />
      {frozen && <div className="mb-4"><Alert kind="warn">The death trigger was activated, so this policy is frozen and can no longer be changed.</Alert></div>}
      {msg.text && <div className="mb-4"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-cream-300 px-4 py-2 text-xs text-ink-400">
              <span>policy.alp</span>
              <span>{result ? (result.ok ? <span className="text-sage-600">✓ valid · {result.rules.length} rules</span> : <span className="text-rose-600">{result.errors.length} error(s)</span>) : '…'}</span>
            </div>
            <div className="flex font-mono text-sm">
              <div aria-hidden className="select-none bg-cream-200/60 px-3 py-4 text-right leading-6 text-ink-400">
                {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <textarea ref={textRef} spellCheck={false} readOnly={frozen} value={source} onChange={(e) => setSource(e.target.value)}
                aria-label="Policy source" className="min-h-[420px] w-full resize-y bg-transparent px-4 py-4 leading-6 text-ink-700 focus:outline-none" style={{ tabSize: 2 }} />
            </div>
          </Card>
          {result && (result.errors.length > 0 || result.warnings.length > 0) && (
            <div className="mt-4 space-y-2">
              {result.errors.map((e, i) => (
                <button key={i} onClick={() => jumpTo(e.line)} className="block w-full text-left"><Alert>Line {e.line}: {e.message}</Alert></button>
              ))}
              {result.warnings.map((w, i) => (
                <button key={`w${i}`} onClick={() => jumpTo(w.line)} className="block w-full text-left"><Alert kind="warn">Line {w.line}: {w.message}</Alert></button>
              ))}
            </div>
          )}
          {!frozen && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary" disabled={busy || !dirty || !result?.ok} onClick={save}>{busy ? 'Saving…' : 'Save new version'}</button>
              <button className="btn-ghost" disabled={!dirty} onClick={() => setSource(policy.data.source)}>Discard changes</button>
              <Link to="/access" className="ml-auto text-sm text-bark-500 hover:underline">See who can access what →</Link>
            </div>
          )}
        </div>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              {[['rules', 'Meaning'], ['prolog', 'Prolog facts'], ['help', 'Cheatsheet'], ['history', 'History']].map(([k, l]) => (
                <button key={k} onClick={() => { setTab(k); if (k === 'help' && !grammar) api('/api/policy/grammar').then((g) => setGrammar(g.ebnf)) }}
                  className={`rounded-lg px-3 py-1.5 ${tab === k ? 'bg-ink-700 text-cream-50' : 'bg-cream-200 text-ink-500'}`}>{l}</button>
              ))}
            </div>
            {tab === 'rules' && (result?.rules?.length ? (
              <ol className="space-y-2 text-sm">{result.rules.map((r, i) => (
                <li key={i} className="flex gap-2"><span className="w-10 shrink-0 text-xs text-ink-400">L{r.line}</span><span><Tag tone={r.type === 'denial' ? 'bark' : 'cream'}>{r.type}</Tag> {r.text}</span></li>
              ))}</ol>) : <p className="text-sm text-ink-400">No rules yet: everything is private.</p>)}
            {tab === 'prolog' && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-800 p-4 text-xs text-cream-100">{(result?.prolog || []).join('\n') || '% no facts'}</pre>}
            {tab === 'help' && (
              <div className="space-y-3 text-sm">
                <p>Your handles: {policy.data.handles.length ? policy.data.handles.map((h) => <Tag key={h} tone="ink">{h}</Tag>) : <Link className="underline" to="/beneficiaries">add beneficiaries</Link>}</p>
                {CHEATSHEET.map(([code, note]) => (
                  <div key={code}><code className="block rounded-lg bg-cream-200 px-2 py-1 text-xs">{code}</code><span className="text-xs text-ink-400">{note}</span></div>
                ))}
                {grammar && <details><summary className="cursor-pointer text-bark-500">Full EBNF grammar</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{grammar}</pre></details>}
              </div>
            )}
            {tab === 'history' && (policy.data.history.length ? (
              <ul className="space-y-2 text-sm">{policy.data.history.map((h) => (
                <li key={h.version} className="flex justify-between"><span>Version {h.version}</span><span className="text-ink-400">{fmtDate(h.created_at)}</span></li>
              ))}</ul>) : <p className="text-sm text-ink-400">Not saved yet.</p>)}
          </Card>
          {!frozen && (
            <Card>
              <h2 className="text-xl font-semibold">Start from a sample</h2>
              <p className="text-xs text-ink-400">Samples use the handles maria, jose and lina; rename them to your own.</p>
              <div className="mt-3 space-y-2">
                {samples.data?.map((s) => (
                  <button key={s.file} className="btn-secondary w-full justify-start text-left" onClick={() => setSource(s.source)}>{s.name}</button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
