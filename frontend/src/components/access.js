// Plain-language explanation of a Prolog access decision (level + reason + policy line).
export function reasonText(d) {
  if (!d) return ''
  const line = d.line ? ` (policy line ${d.line})` : ''
  if (d.reason.startsWith('granted_by')) return `Allowed${line}`
  if (d.reason.startsWith('released_by')) return `Letter released${line}`
  if (d.reason.startsWith('denied_by')) return `Explicitly denied${line}`
  if (d.reason.startsWith('pending')) return `Will open later${line}`
  return {
    default_deny: 'Nothing allows it (deny by default)',
    owner_alive: 'Opens only after your passing',
    not_recipient: 'Letter addressed to someone else',
    letter_sealed: 'Letter not yet due',
    not_beneficiary: 'Not an active beneficiary',
  }[d.reason] || d.reason
}
