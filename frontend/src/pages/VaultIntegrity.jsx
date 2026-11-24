import { useState } from 'react'
import { api, fmtDate } from '../api'
import { Alert, Card, Hash, PageHeader, Section, Spinner, Tag, useAsync, useToast } from '../components/ui'
import NavIcon from '../components/NavIcon'

function Report({ title, r }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wider text-ink-400">{title}</p>
      <p className={`mt-1 text-2xl font-semibold ${r.ok ? 'text-sage-600' : 'text-rose-600'}`}>{r.ok ? 'Verified' : 'Verification failed'}</p>
      <p className="text-sm text-ink-400">{r.length} records · head <Hash value={r.head} /></p>
      {r.problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-rose-600">{r.problems.map((p, i) => <li key={i}>#{p.seq} {p.ref}: {p.problem}</li>)}</ul>
      )}
    </Card>
  )
}

export default function VaultIntegrity() {
  const v = useAsync(() => api('/api/vault/verify'))
  const audit = useAsync(() => api('/api/vault/audit'))
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState('chain')
  const toast = useToast()

  const exportVault = async () => {
    setExporting(true)
    try {
      const data = await api('/api/vault/export')
      if (import.meta.env.VITE_WEB_RUNTIME === '1') {
        // Downloads are not available inside the hosted demo frame, so copy the export instead.
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
        setError('')
        setCopied(true); toast('Vault export copied to the clipboard.')
        return
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: `alaala-vault-${new Date().toISOString().slice(0, 10)}.json` })
      a.click(); URL.revokeObjectURL(url); toast('Vault export downloaded.')
    } catch (e) { setError(e.message) } finally { setExporting(false) }
  }

  return (
    <>
      <PageHeader title="Vault integrity"
        actions={<>
          <button className="btn-secondary" onClick={() => { v.reload(); audit.reload() }}>Verify again</button>
          <button className="btn-secondary" onClick={exportVault} disabled={exporting}>{exporting ? 'Exporting…' : copied ? 'Copied to clipboard ✓' : import.meta.env.VITE_WEB_RUNTIME === '1' ? 'Copy vault export (JSON)' : 'Export vault (JSON)'}</button>
        </>} />
      <Alert onClose={() => setError('')}>{error}</Alert>
      {v.loading ? <Spinner label="Verifying your vault" /> : v.error ? (
        <div className="mb-6 rounded-2xl bg-cream-200 px-6 py-4 text-ink-600" role="status">
          <p className="text-xl font-semibold">We couldn't verify your vault</p>
          <p className="mt-1 text-sm">{v.error} This doesn't mean anything changed.</p>
          <button className="btn-secondary mt-3" onClick={() => { v.reload(); audit.reload() }}>Try again</button>
        </div>
      ) : (
        <>
          <div className={`mb-6 flex items-start gap-4 rounded-2xl border px-6 py-5 ${v.data.ok ? 'border-sage-600/20 bg-sage-100 text-sage-600' : 'border-rose-600/20 bg-rose-100 text-rose-600'}`}>
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/60"><NavIcon name={v.data.ok ? 'access' : 'close'} size={20} /></span>
            <div>
            <p className="text-xl font-semibold">{v.data.ok ? 'Verified: every record matches its hash' : 'Verification failed'}</p>
            <p className="text-sm">{v.data.ok
              ? `Checked ${new Date().toLocaleString()}. No entry, revision, policy version or audit event was changed or removed since it was saved.`
              : 'Some records no longer match their hashes, so they were changed outside MMK. Nothing is shared with beneficiaries until this is resolved. Contact the MMK administrator and keep an exported copy.'}</p>
            {v.data.sealed && <p className="text-sm">The vault is sealed; no new records can be appended.</p>}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Report title="Entries & revisions" r={v.data.entries} />
            <Report title="Policy versions" r={v.data.policy} />
            <Report title="Audit log" r={v.data.audit} />
          </div>

        </>
      )}

      <Section className="mt-6" bodyClassName="p-5 sm:p-6"
        title={<div role="tablist" className="flex rounded-xl border border-cream-300 bg-cream-100 p-1 text-sm font-medium">
          {[['chain', 'Record chain', v.data?.records?.length], ['audit', 'Audit log', audit.data?.length]].map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-lg px-3 py-1.5 transition ${view === k ? 'bg-ink-700 text-cream-50' : 'text-ink-500 hover:bg-cream-200'}`}>
              {l}{n != null && <span className={`ml-1.5 text-xs ${view === k ? 'text-cream-200' : 'text-ink-400'}`}>{n}</span>}
            </button>
          ))}
        </div>}>
        {view === 'chain' ? (v.data ? <div className="max-h-[32rem] overflow-auto">
            <ol className="relative space-y-3 border-l-2 border-gold-400/60 pl-6">
            {v.data.records.map((r) => (
              <li key={r.seq} className="relative">
                <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-gold-500 bg-cream-50" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-ink-400">#{r.seq}</span>
                  <Tag tone={r.kind === 'revision' ? 'bark' : 'cream'}>{r.kind}</Tag>
                  <span className="font-medium">{r.title || (r.kind === 'revision' ? r.ref : 'Untitled')}</span>
                  {r.date && <span className="text-xs text-ink-400">{fmtDate(r.date)}</span>}
                  <span className="text-xs text-ink-400">prev <Hash value={r.prev_hash} n={8} /> → <Hash value={r.hash} n={8} /></span>
                </div>
              </li>
            ))}
          </ol>
        </div> : <p className="text-sm text-ink-400">Run the check to see the chain.</p>) : (
          <>
        {audit.loading ? <Spinner label="Loading audit log" /> : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="sticky top-0 bg-cream-50 text-left text-xs text-ink-400"><th className="py-2">When</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
              <tbody>
                {(audit.data || []).map((a) => (
                  <tr key={a.id} className="border-t border-cream-300/60 align-top">
                    <td className="py-2 pr-3 text-xs text-ink-400 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="pr-3"><code className="text-xs">{a.action}</code></td>
                    <td className="pr-3 text-xs">{a.actor_role}</td>
                    <td className="text-xs text-ink-400 break-all">{Object.entries(a.detail).map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : typeof val === 'object' && val ? JSON.stringify(val) : val}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
          </>
        )}
      </Section>
    </>
  )
}
