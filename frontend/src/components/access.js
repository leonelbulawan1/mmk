// Plain-language explanation of a Prolog access decision (level + reason + policy line).
export function reasonText(d) {
  if (!d) return ''
  const line = d.line ? ` (policy line ${d.line})` : ''
  if (d.reason.startsWith('granted_by')) return `Allowed${line}`
  if (d.reason.startsWith('released_by')) return `Letter released${line}`
  if (d.reason.startsWith('denied_by')) return `Explicitly denied${line}`
  if (d.reason.startsWith('pending')) return `Opens later${line}`
  return {
    default_deny: 'No rule allows it',
    owner_alive: 'After passing',
    not_recipient: 'Not the recipient',
    letter_sealed: 'Not yet due',
    not_beneficiary: 'Inactive',
  }[d.reason] || d.reason
}
