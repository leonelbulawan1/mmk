import { useEffect, useState } from 'react'

function Eye({ open }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  )
}

// A password field with a show/hide (eye) toggle. Accepts the same props as <input>.
// The eye appears only once something has been typed; clearing the field hides it again.
export default function PasswordInput({ className = '', icon: Icon, ...props }) {
  const [visible, setVisible] = useState(false)
  const hasValue = String(props.value ?? '').length > 0
  useEffect(() => { if (!hasValue) setVisible(false) }, [hasValue])
  return (
    <div className="relative">
      {Icon && (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-ink-400">
          <Icon />
        </span>
      )}
      <input {...props} type={visible ? 'text' : 'password'} className={`input pr-11 ${Icon ? 'pl-11' : ''} ${className}`} />
      {hasValue && <button type="button" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-400 transition hover:text-ink-700 fade-in">
        <Eye open={visible} />
      </button>}
    </div>
  )
}
