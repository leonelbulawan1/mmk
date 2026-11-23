import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { FieldMessage } from './icons'

// Title of a page: name, one short line about it, and the page's main actions on the right.
export function PageHeader({ eyebrow, title, subtitle, actions, meta }) {
  return (
    <header className="mb-4 flex flex-col gap-3 border-b border-cream-300 pb-3 sm:flex-row sm:items-end sm:justify-between fade-in">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-ink-400">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold leading-tight">{title}</h1>
          {meta}
        </div>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

// A titled card: heading row (title, short description, actions) above the content.
export function Section({ title, description, actions, children, className = '', bodyClassName = 'p-5 sm:p-6', id }) {
  return (
    <section id={id} className={`card scroll-mt-8 p-0 fade-in ${className}`} aria-labelledby={id && `${id}-h`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cream-300/80 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (typeof title === 'string' ? <h2 id={id && `${id}-h`} className="text-lg font-semibold">{title}</h2> : title)}
            {description && <p className="mt-0.5 text-sm text-ink-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
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
      {hint && !error && <span className="mt-1.5 block text-xs text-ink-400">{hint}</span>}
      <FieldMessage error={error} />
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
      <div className="flex items-start gap-2.5">{(kind === 'error' || kind === 'warn') && <AlertIcon />}<div>{children}</div></div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">×</button>}
    </div>
  )
}

// Loading indicator. After a few seconds it explains the wait (the free server sleeps when idle).
export function Spinner({ label = 'Loading' }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(t) }, [])
  return (
    <div className="flex flex-col items-start gap-1 py-10 text-ink-400" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
        <span className="text-sm">{label}…</span>
      </div>
      {slow && <p className="pl-7 text-xs">This is taking longer than usual. The server may be starting up; it can take up to a minute.</p>}
    </div>
  )
}

// Short confirmations ("Profile saved."), shown in the corner and gone after a few seconds.
const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const remove = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const show = useCallback((text, kind = 'success') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs.slice(-2), { id, text, kind }])
    setTimeout(() => remove(id), kind === 'error' ? 7000 : 4000)
  }, [remove])
  const tone = { success: 'border-sage-600/25 text-sage-600', error: 'border-rose-600/25 text-rose-600', info: 'border-cream-300 text-ink-600' }
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-cream-50 px-4 py-3 text-sm font-medium shadow-paper fade-in ${tone[t.kind] || tone.info}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px shrink-0">
              {t.kind === 'error' ? <><circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.5h.01" /></> : <><circle cx="12" cy="12" r="9.5" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>}
            </svg>
            <span className="flex-1 text-ink-700">{t.text}</span>
            <button type="button" onClick={() => remove(t.id)} aria-label="Dismiss" className="-mr-1 text-ink-400 hover:text-ink-700">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50/60 px-6 py-12 text-center">
      <p className="text-lg font-semibold text-ink-600">{title}</p>
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

/**
 * Accessible modal dialog: role="dialog", aria-modal, Escape closes, focus moves into it on open and
 * returns to where it was on close, Tab stays inside. Fits small screens (scrolls inside).
 */
export function Dialog({ open, title, onClose, children, footer, wide = false, eyebrow, meta, closeButton = false, size, icon }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const before = document.activeElement
    const node = ref.current
    const focusables = () => [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled)
    ;(node.querySelector('[data-autofocus]') || focusables()[0] || node).focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.() }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; before?.focus?.() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-700/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl shadow-paper sm:rounded-2xl ${icon ? 'bg-cream-100' : 'bg-cream-50'} ${size === 'xl' ? 'sm:max-w-5xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}>
        {icon ? (
          /* Same header as the writing window (New diary / New letter). */
          <div className="flex items-center gap-2.5 border-b border-cream-300 px-4 py-3 sm:px-6">
            <span className="text-bark-500">{icon}</span>
            <h2 id="dialog-title" className="text-lg font-semibold">{title}</h2>
          </div>
        ) : eyebrow || meta || closeButton ? (
          <div className="flex items-start justify-between gap-4 border-b border-cream-300 px-6 pb-4 pt-5 sm:px-8 sm:pt-6">
            <div className="min-w-0">
              {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.08em] text-bark-500">{eyebrow}</p>}
              <h2 id="dialog-title" className="mt-1.5 text-2xl font-semibold leading-tight">{title}</h2>
              {meta && <div className="mt-2 text-sm text-ink-400">{meta}</div>}
            </div>
            {closeButton && onClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="btn-ghost btn-icon -mr-2 -mt-1 h-10 w-10 text-ink-400">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0 }}><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            )}
          </div>
        ) : <h2 id="dialog-title" className="px-6 pt-5 text-lg font-semibold">{title}</h2>}
        <div className={`min-h-0 flex-1 overflow-y-auto ${icon ? 'p-3 sm:p-5' : eyebrow || meta ? 'px-6 py-6 sm:px-8' : 'px-6 py-4'}`}>{children}</div>
        {footer && <div className={`flex flex-wrap justify-end gap-2 border-t border-cream-300 py-4 ${eyebrow || meta ? 'bg-cream-100/60 px-6 sm:rounded-b-2xl sm:px-8' : 'px-6'}`}>{footer}</div>}
      </div>
    </div>
  )
}

/** Yes/no confirmation built on Dialog. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, busy = false, danger = false }) {
  return (
    <Dialog open={open} title={title} onClose={busy ? undefined : onCancel}
      footer={<>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" data-autofocus className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy ? 'Please wait…' : confirmLabel}</button>
      </>}>
      <div className="text-sm text-ink-600">{children}</div>
    </Dialog>
  )
}
