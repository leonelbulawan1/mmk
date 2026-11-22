// Small line icons for form fields (decorative: the inputs carry aria-labels).
const base = { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const MailIcon = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" /></svg>
)
export const LockIcon = () => (
  <svg {...base}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
)
export const UserIcon = () => (
  <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></svg>
)
export const KeyIcon = () => (
  <svg {...base}><circle cx="8" cy="15" r="4" /><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></svg>
)

// A text input with an icon inside on the left. Same props as <input>.
export function IconInput({ icon: Icon, className = '', ...props }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-ink-400">
        <Icon />
      </span>
      <input {...props} className={`input pl-11 ${className}`} />
    </div>
  )
}
