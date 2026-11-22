import { useState } from 'react'
import { api, fmtDate } from '../api'
import { Alert, Card, Hash, PageHeader, Spinner, Tag, useAsync } from '../components/ui'

function Report({ title, r }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wider text-ink-400">{title}</p>
      <p className={`mt-1 text-3xl font-semibold ${r.ok ? 'text-sage-600' : 'text-rose-600'}`}>{r.ok ? 'Intact' : 'Tampered'}</p>
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

  const exportVault = async () => {
    setExporting(true)
    try {
      const data = await api('/api/vault/export')
      if (import.meta.env.VITE_WEB_RUNTIME === '1') {
        // Downloads are not available inside the hosted demo frame, so copy the export instead.
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
        setError('')
        setCopied(true)
        return
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: `alaala-vault-${new Date().toISOString().slice(0, 10)}.json` })
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) } finally { setExporting(false) }
  }

  return (
    <>
      <PageHeader eyebrow="nothing changes unseen" title="Vault integrity"
        subtitle="Each record's hash includes the previous record's hash. Recomputing the chain proves no entry, revision, policy version or audit event was altered or removed."
        actions={<>
          <button className="btn-secondary" onClick={() => { v.reload(); audit.reload() }}>Verify again</button>
          <button className="btn-secondary" onClick={exportVault} disabled={exporting}>{exporting ? 'Exporting…' : copied ? 'Copied to clipboard ✓' : import.meta.env.VITE_WEB_RUNTIME === '1' ? 'Copy vault export (JSON)' : 'Export vault (JSON)'}</button>
        </>} />
      <Alert onClose={() => setError('')}>{error}</Alert>
      {v.loading ? <Spinner label="Recomputing hashes" /> : v.error ? <Alert>{v.error}</Alert> : (
        <>
          <div className={`mb-6 rounded-2xl px-6 py-4 ${v.data.ok ? 'bg-sage-100 text-sage-600' : 'bg-rose-100 text-rose-600'}`}>
            <p className="text-2xl font-semibold">{v.data.ok ? '✓ Every record verified' : '⚠ Integrity problems found'}</p>
            {v.data.sealed && <p className="text-sm">The vault is sealed; no new records can be appended.</p>}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Report title="Entries & revisions" r={v.data.entries} />
            <Report title="Policy versions" r={v.data.policy} />
            <Report title="Audit log" r={v.data.audit} />
          </div>

          <Card className="mt-6 overflow-x-auto">
            <h2 className="mb-4 text-2xl font-semibold">The chain</h2>
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
          </Card>
        </>
      )}

      <Card className="mt-6">
        <h2 className="mb-4 text-2xl font-semibold">Audit log</h2>
        {audit.loading ? <Spinner /> : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-400"><th className="py-2">When</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
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
      </Card>
    </>
  )
}
