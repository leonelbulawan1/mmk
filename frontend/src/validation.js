// Form checks shared by every form, with the same wording everywhere.
// Each rule returns an error message, or '' when the value is fine.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const rules = {
  required: (label) => (v) => (String(v ?? '').trim() ? '' : `Enter ${label}.`),
  email: (v) => {
    const s = String(v ?? '').trim()
    if (!s) return 'Enter your email address.'
    return EMAIL.test(s) ? '' : 'Enter a valid email address, like name@gmail.com.'
  },
  otherEmail: (v) => {
    const s = String(v ?? '').trim()
    if (!s) return 'Enter their email address.'
    return EMAIL.test(s) ? '' : 'Enter a valid email address, like name@gmail.com.'
  },
  newPassword: (v) => {
    const s = String(v ?? '')
    if (!s) return 'Create a password.'
    if (s.length < 8) return 'Use at least 8 characters.'
    if (!/[a-z]/i.test(s) || !/\d/.test(s)) return 'Use both letters and numbers.'
    return ''
  },
  password: (v) => (String(v ?? '') ? '' : 'Enter your password.'),
  code6: (v) => (/^\d{6}$/.test(String(v ?? '')) ? '' : 'Enter the 6-digit code.'),
  handle: (v) => {
    const s = String(v ?? '')
    if (!s) return 'Enter a policy handle.'
    return /^[a-z][a-z0-9_]{1,31}$/.test(s) ? '' : 'Use 2 to 32 lowercase letters, numbers or underscores, starting with a letter.'
  },
  phrase: (phrase) => (v) => (v === phrase ? '' : `Type ${phrase} exactly as shown.`),
}

// Run rules over a form: { field: rule } -> { field: message } (only fields with a problem).
export function check(values, spec) {
  const out = {}
  for (const [k, rule] of Object.entries(spec)) { const m = rule(values[k]); if (m) out[k] = m }
  return out
}

// Put the cursor in the first field with a problem.
export function focusFirst(errors, ids = {}) {
  const first = Object.keys(errors)[0]
  if (first) setTimeout(() => document.getElementById(ids[first] || first)?.focus(), 0)
}
