import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDate, today } from '../api'
import { Alert, Card, Empty, LetterBadge, LevelBadge, PageHeader, Spinner, useAsync } from '../components/ui'
import { reasonText } from '../components/access'

export default function AccessPermissions() {
  const [date, setDate] = useState(today())
  const m = useAsync(() => api(`/api/access/matrix?on=${date}`), [date])
  const [focus, setFocus] = useState(null)

  return (
    <>
      <PageHeader title="Access permissions"
        subtitle="What each beneficiary will be able to see after your passing, decided by the Prolog rules. Choose a later date to see what date-based releases will open."
        actions={<Link to="/policy" className="btn-secondary">Edit policy</Link>} />

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <label className="flex items-center gap-3 text-sm"><span className="font-medium text-ink-600">Evaluate on</span>
          <input type="date" className="input w-44 py-2" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <button className="btn-ghost px-3 py-2" onClick={() => setDate(today())}>Today</button>
        <div className="flex flex-wrap items-center gap-2 text-xs sm:ml-auto">
          <span className="text-ink-400">Levels:</span>
          {['none', 'existence', 'summary', 'verbatim'].map((l) => <LevelBadge key={l} level={l} />)}
        </div>
      </div>

      {m.loading ? <Spinner label="Checking access with the Prolog rules" /> : m.error ? <Alert>{m.error}</Alert> : !m.data.beneficiaries.length ? (
        <Empty title="No beneficiaries" action={<Link className="btn-primary" to="/beneficiaries">Add one</Link>}>Access is decided per beneficiary.</Empty>
      ) : !m.data.entries.length ? (
        <Empty title="No entries yet">Write something first.</Empty>
      ) : (
        <>
          <div className="mb-4"><Alert kind="info">{m.data.death_triggered
            ? 'The death trigger is active: this is what each beneficiary can see now.'
            : 'Preview: this is what each beneficiary will see after your passing. Today they see nothing.'}</Alert></div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-cream-300 bg-cream-100 text-left">
                  <th className="sticky left-0 z-10 bg-cream-100 px-5 py-3 font-medium">Entry</th>
                  {m.data.beneficiaries.map((b) => <th key={b.handle} className="px-4 py-3 font-medium">{b.display_name}<span className="block text-xs font-normal text-ink-400">{b.handle}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {m.data.entries.map((e) => (
                  <tr key={e.id} className="border-b border-cream-200 last:border-0 hover:bg-cream-100/50">
                    <td className="sticky left-0 bg-cream-50 px-5 py-3">
                      <Link to={`/entries/${e.id}`} className="text-base font-semibold hover:text-bark-500">{e.title || 'Untitled'}</Link>{e.kind === 'letter' && <LetterBadge className="ml-2 align-middle" />}
                      <span className="block text-xs text-ink-400">{fmtDate(e.date)}{e.topics.length ? ` · ${e.topics.join(', ')}` : ''}</span>
                    </td>
                    {m.data.beneficiaries.map((b) => {
                      const d = m.data.decisions[b.handle]?.[String(e.id)]
                      return (
                        <td key={b.handle} className="px-4 py-3">
                          <button className="text-left" onClick={() => setFocus({ entry: e, b, d })} title={reasonText(d)}>
                            <LevelBadge level={d?.level || 'none'} />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {focus && (
            <Card className="mt-4 border-gold-500/30">
              <p className="text-sm"><b>{focus.b.display_name}</b> → <b>{focus.entry.title || 'Untitled'}</b> ({fmtDate(focus.entry.date)}) on {fmtDate(m.data.date)}:</p>
              <p className="mt-1 flex items-center gap-2"><LevelBadge level={focus.d?.level || 'none'} /> <span className="text-sm text-ink-500">{reasonText(focus.d)}</span></p>
              <p className="mt-1 font-mono text-xs text-ink-400">prolog: decision({focus.b.handle}, {focus.entry.id}, …, {focus.d?.level}, {focus.d?.reason})</p>
            </Card>
          )}
        </>
      )}
    </>
  )
}
