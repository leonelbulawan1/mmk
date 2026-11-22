import { useState } from 'react'
import { api, fmtDate } from '../api'
import { Alert, Tag, useAsync } from './ui'

const STATUS = {
  sent: ['Accepted for delivery', 'bg-sage-100 text-sage-600'],
  delivered: ['Delivered', 'bg-sage-100 text-sage-600'],
  queued: ['Queued', 'bg-cream-200 text-ink-500'],
  sending: ['Sending', 'bg-cream-200 text-ink-500'],
  retrying: ['Will retry', 'bg-[#FBF0D9] text-bark-600'],
  failed: ['Failed', 'bg-rose-100 text-rose-600'],
  bounced: ['Address does not exist', 'bg-rose-100 text-rose-600'],
  unknown: ['Check before resending', 'bg-[#FBF0D9] text-bark-600'],
  sandboxed: ['Not sent (test mode)', 'bg-cream-200 text-ink-500'],
  not_configured: ['Not sent', 'bg-[#FBF0D9] text-bark-600'],
}

// Email notices sent to beneficiaries after the death trigger (owner view).
export default function EmailNotices() {
  const n = useAsync(() => api('/api/settings/notifications'))
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const retry = async (id) => {
    setBusy(id); setError('')
    try { n.setData(await api(`/api/settings/notifications/${id}/retry`, { method: 'POST' })) }
    catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  if (n.loading || !n.data) return null
  const { notices, email_configured: configured } = n.data
  return (
    <div className="mt-6 border-t border-cream-300 pt-5">
      <h3 className="text-lg font-semibold">Email notices to beneficiaries</h3>
      <p className="mt-1 text-sm text-ink-500">
        Each beneficiary with something to read gets a short notice and a sign-in link. No diary content is ever put in an email.
      </p>
      {!configured && notices.some((x) => x.status !== 'sent') && (
        <div className="mt-3"><Alert kind="warn">Email sending is not set up on this server, so these notices are waiting here. Once SMTP is configured, use Retry to send them.</Alert></div>
      )}
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {notices.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">No beneficiary had anything released to them, so no emails were needed.</p>
      ) : (
        <ul className="mt-3 divide-y divide-cream-300 rounded-xl border border-cream-300">
          {notices.map((x) => {
            const [label, cls] = STATUS[x.status] || [x.status, 'bg-cream-200 text-ink-500']
            return (
              <li key={x.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{x.to_name || x.to_email}</p>
                    <p className="truncate text-xs text-ink-400">{x.to_email} · {['sent', 'delivered'].includes(x.status) ? `sent ${fmtDate(x.sent_at)}`
                      : `${x.attempts} attempt${x.attempts === 1 ? '' : 's'}${x.status === 'retrying' && x.next_attempt_at ? ` · next try ${new Date(x.next_attempt_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
                    <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Hide' : 'View email'}</button>
                    {!['sent', 'delivered', 'sending'].includes(x.status) && (
                      <button className="btn-secondary px-3 py-1 text-xs" disabled={!configured || busy === x.id} onClick={() => retry(x.id)}
                        title={configured ? 'Send again' : 'Set up email on the server first'}>{busy === x.id ? 'Sending…' : x.status === 'unknown' ? 'Send anyway' : 'Retry now'}</button>
                    )}
                  </div>
                </div>
                {x.error && ['failed', 'retrying', 'unknown', 'bounced', 'sandboxed'].includes(x.status) && <p className="mt-2 text-xs text-rose-600">{x.error}</p>}
                {open === x.id && (
                  <div className="mt-3 rounded-xl bg-cream-100 p-4 text-sm">
                    <p className="text-xs text-ink-400">Subject</p>
                    <p className="font-medium">{x.subject}</p>
                    <pre className="mt-3 whitespace-pre-wrap font-sans text-ink-600">{x.body}</pre>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-400"><Tag>Note</Tag> Letters set to open on a later date are not emailed again when they open.</p>
    </div>
  )
}
