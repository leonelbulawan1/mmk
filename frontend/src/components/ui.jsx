import { useEffect, useState } from 'react'

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between fade-in">
      <div>
        {eyebrow && <p className="text-sm font-medium text-bark-500">{eyebrow}</p>}
        <h1 className="text-4xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function Card({ className = '', children, ...rest }) {
  return <div className={`card p-6 fade-in ${className}`} {...rest}>{children}</div>
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  )
}

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0">
    <circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.5h.01" />
  </svg>
)

export function Alert({ kind = 'error', children, onClose }) {
  if (!children) return null
  const styles = {
    error: 'bg-rose-100 text-rose-600 border-rose-600/20',
    success: 'bg-sage-100 text-sage-600 border-sage-600/20',
    info: 'bg-cream-200 text-ink-600 border-cream-300',
    warn: 'bg-[#FBF0D9] text-bark-600 border-gold-500/30',
  }
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${styles[kind]}`}>
      <div className="flex items-start gap-2.5">{kind === 'error' && <AlertIcon />}<div>{children}</div></div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">×</button>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-3 py-10 text-ink-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
      <span className="text-sm">{label}…</span>
    </div>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50/60 px-6 py-12 text-center">
      <p className="text-2xl text-ink-600">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

const LEVEL_STYLE = {
  none: 'bg-cream-200 text-ink-400',
  existence: 'bg-[#EDE7F6] text-[#5B4A86]',
  summary: 'bg-[#FBF0D9] text-bark-600',
  verbatim: 'bg-sage-100 text-sage-600',
}
const LEVEL_LABEL = { none: 'Hidden', existence: 'Exists only', summary: 'Summary', verbatim: 'Full text' }

export function LevelBadge({ level }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${LEVEL_STYLE[level] || LEVEL_STYLE.none}`}>{LEVEL_LABEL[level] || level}</span>
}

export function Tag({ children, tone = 'cream' }) {
  const tones = { cream: 'bg-cream-200 text-ink-500', ink: 'bg-ink-700 text-cream-50', bark: 'bg-bark-500/10 text-bark-600' }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
}

export function Hash({ value, n = 10 }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(t) } }, [copied])
  if (!value) return null
  return (
    <button type="button" title={value} onClick={() => { navigator.clipboard?.writeText(value); setCopied(true) }}
      className="font-mono text-xs text-ink-400 hover:text-ink-700">
      {copied ? 'copied' : `${value.slice(0, n)}…`}
    </button>
  )
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try { setState({ data: await fn(), error: null, loading: false }) }
    catch (e) { setState({ data: null, error: e.message, loading: false }) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, deps)
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) }
}

/** "Letter" marker (replaces the ✉ emoji). With `to`, reads "Letter to <name>". */
export function LetterBadge({ to, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-ink-700 px-2.5 py-0.5 text-xs font-medium text-cream-50 ${className}`}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" />
      </svg>
      {to ? <>Letter to {to}</> : 'Letter'}
    </span>
  )
}

/** Required by the project rules: letters and the legacy policy are personal wishes, not a legal will. */
export function LegalDisclaimer({ compact = false, className = '' }) {
  return (
    <div role="note" className={`flex gap-2.5 rounded-xl border border-cream-300 bg-cream-100 px-3.5 py-3 text-xs leading-relaxed text-ink-500 ${className}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-bark-500">
        <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" />
      </svg>
      <p>
        <b className="font-semibold text-ink-600">Not a legal will.</b>{' '}
        {compact
          ? 'This letter is a personal message. It has no legal effect.'
          : 'Letters and the legacy policy in MMK are personal messages and wishes. They are not a will and have no legal effect on property or inheritance. Philippine law has formal requirements for wills; for those, consult a lawyer. MMK does not give legal advice.'}
      </p>
    </div>
  )
}
