// Icons for form fields, from the app's icon set (decorative: the inputs carry aria-labels).
import { Icon } from './NavIcon'
export const MailIcon = () => <Icon name="letters" size={16} />
export const LockIcon = () => <Icon name="lock" size={16} />
export const UserIcon = () => <Icon name="person" size={16} />
export const KeyIcon = () => <Icon name="key" size={16} />

// A text input with an icon inside on the left. Same props as <input>.
// With `error`, the field turns red and the message is shown under it (and read by screen readers).
export function IconInput({ icon: Icon, className = '', error, ...props }) {
  const msgId = error && props.id ? `${props.id}-error` : undefined
  return (
    <div>
      <div className="relative">
        <span className={`pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center ${error ? 'text-rose-600' : 'text-ink-400'}`}>
          <Icon />
        </span>
        <input {...props} aria-invalid={!!error} aria-describedby={msgId} className={`input pl-11 ${error ? 'border-rose-600 focus:border-rose-600 focus:ring-rose-600/20' : ''} ${className}`} />
      </div>
      <FieldMessage id={msgId} error={error} />
    </div>
  )
}

export function FieldMessage({ id, error }) {
  if (!error) return null
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-600">
      <Icon name="error" size={14} className="mt-px" />
      {error}
    </p>
  )
}
