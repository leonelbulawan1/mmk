import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate } from '../api'
import { Alert, LegalDisclaimer, PageHeader, Section, Spinner, Tag, useAsync } from '../components/ui'

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
      <PageHeader title="Legacy policy"
        subtitle="Who may see what after your passing, and when. Nothing is shared while you are alive, and anything you do not allow stays private."
        meta={<><Tag tone="ink">Version {policy.data.version}</Tag>{frozen && <Tag tone="bark">Frozen</Tag>}</>}
        actions={!frozen && <>
          <Link to="/access" className="btn-ghost">See access</Link>
          <button className="btn-secondary" disabled={!dirty} onClick={() => setSource(policy.data.source)}>Discard changes</button>
          <button className="btn-primary" disabled={busy || !dirty || !result?.ok} onClick={save}>{busy ? 'Saving…' : 'Save new version'}</button>
        </>} />
      {frozen && <div className="mb-4"><Alert kind="warn">The death trigger was activated, so this policy is frozen and can no longer be changed.</Alert></div>}
      {msg.text && <div className="mb-4"><Alert kind={msg.kind} onClose={() => setMsg({})}>{msg.text}</Alert></div>}

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <Section title="Policy rules" bodyClassName="p-0"
            description={dirty ? 'Unsaved changes' : `Saved as version ${policy.data.version}`}
            actions={<span className="text-xs font-medium">{result ? (result.ok
              ? <span className="rounded-full bg-sage-100 px-2.5 py-1 text-sage-600">Valid · {result.rules.length} rules</span>
              : <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-600">{result.errors.length} error{result.errors.length === 1 ? '' : 's'}</span>) : <span className="text-ink-400">Checking…</span>}</span>}>
            <div className="flex font-mono text-sm">
              <div aria-hidden className="select-none rounded-bl-2xl bg-cream-200/60 px-3 py-4 text-right leading-6 text-ink-400">
                {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <textarea ref={textRef} spellCheck={false} readOnly={frozen} value={source} onChange={(e) => setSource(e.target.value)}
                aria-label="Policy source" className="min-h-[480px] w-full resize-y bg-transparent px-4 py-4 leading-6 text-ink-700 focus:outline-none" style={{ tabSize: 2 }} />
            </div>
          </Section>
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
          <LegalDisclaimer className="mt-4" />
        </div>

        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Section bodyClassName="p-5">
            <div role="tablist" className="mb-4 flex rounded-xl border border-cream-300 bg-cream-100 p-1 text-sm">
              {[['rules', 'Meaning'], ['prolog', 'Prolog'], ['help', 'Cheatsheet'], ['history', 'History']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); if (k === 'help' && !grammar) api('/api/policy/grammar').then((g) => setGrammar(g.ebnf)) }}
                  className={`flex-1 rounded-lg px-2 py-1.5 font-medium transition ${tab === k ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200'}`}>{l}</button>
              ))}
            </div>
            {tab === 'rules' && (result?.rules?.length ? (
              <ol className="space-y-2.5 text-sm">{result.rules.map((r, i) => (
                <li key={i} className="flex gap-3"><span className="w-8 shrink-0 pt-0.5 font-mono text-xs text-ink-400">L{r.line}</span><span><Tag tone={r.type === 'denial' ? 'bark' : 'cream'}>{r.type}</Tag> {r.text}</span></li>
              ))}</ol>) : <p className="text-sm text-ink-400">No rules yet: everything is private.</p>)}
            {tab === 'prolog' && <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl bg-ink-800 p-4 text-xs text-cream-100">{(result?.prolog || []).join('\n') || '% no facts'}</pre>}
            {tab === 'help' && (
              <div className="space-y-3 text-sm">
                <p className="flex flex-wrap items-center gap-1.5">Your handles: {policy.data.handles.length ? policy.data.handles.map((h) => <Tag key={h} tone="ink">{h}</Tag>) : <Link className="underline" to="/beneficiaries">add beneficiaries</Link>}</p>
                {CHEATSHEET.map(([code, note]) => (
                  <div key={code}><code className="block rounded-lg bg-cream-200 px-2 py-1 text-xs">{code}</code><span className="text-xs text-ink-400">{note}</span></div>
                ))}
                {grammar && <details><summary className="cursor-pointer text-bark-500">Full EBNF grammar</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{grammar}</pre></details>}
              </div>
            )}
            {tab === 'history' && (policy.data.history.length ? (
              <ul className="divide-y divide-cream-200 text-sm">{policy.data.history.map((h) => (
                <li key={h.version} className="flex justify-between py-2"><span className="font-medium">Version {h.version}</span><span className="text-ink-400">{fmtDate(h.created_at)}</span></li>
              ))}</ul>) : <p className="text-sm text-ink-400">Not saved yet.</p>)}
          </Section>
          {!frozen && (
            <Section title="Start from a sample" description="Samples use the handles maria, jose and lina; rename them to your own.">
              <div className="grid gap-2">
                {samples.data?.map((s) => (
                  <button key={s.file} className="btn-secondary w-full justify-between text-left" onClick={() => setSource(s.source)}>{s.name}<span aria-hidden className="text-ink-400">→</span></button>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}
