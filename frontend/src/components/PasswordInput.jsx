import { useEffect, useState } from 'react'
import { FieldMessage } from './icons'
import { Icon } from './NavIcon'

function Eye({ open }) {
  return <Icon name={open ? 'eye' : 'eye-slash'} size={18} />
}

// A password field with a show/hide (eye) toggle. Accepts the same props as <input>.
// The eye appears only once something has been typed; clearing the field hides it again.
export default function PasswordInput({ className = '', icon: Icon, error, hint, ...props }) {
  const [visible, setVisible] = useState(false)
  const hasValue = String(props.value ?? '').length > 0
  useEffect(() => { if (!hasValue) setVisible(false) }, [hasValue])
  const msgId = (error || hint) && props.id ? `${props.id}-msg` : undefined
  return (
    <div>
    <div className="relative">
      {Icon && (
        <span className={`pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center ${error ? 'text-rose-600' : 'text-ink-400'}`}>
          <Icon />
        </span>
      )}
      <input {...props} aria-invalid={!!error} aria-describedby={msgId} type={visible ? 'text' : 'password'}
        className={`input pr-11 ${Icon ? 'pl-11' : ''} ${error ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''} ${className}`} />
      {hasValue && <button type="button" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-ink-400 transition hover:text-ink-700 fade-in">
        <Eye open={visible} />
      </button>}
    </div>
    {error ? <FieldMessage id={msgId} error={error} /> : hint ? <p id={msgId} className="mt-1.5 text-xs text-ink-400">{hint}</p> : null}
    </div>
  )
}
