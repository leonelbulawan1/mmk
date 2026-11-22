// Automatic spelling and grammar correction while typing, like a phone keyboard.
// Uses the same word list as the server's Light Fix (backend/app/processing/typos.json).
// Only small, safe fixes: known misspellings, "could of" → "could have", "i" → "I",
// a capital letter at the start of a sentence, a repeated word, a space before punctuation.
import data from '../../backend/app/processing/typos.json'

const WORDS = data.words
const PHRASES = Object.entries(data.phrases).sort((a, b) => b[0].length - a[0].length)
const NO_NAMES = new Map()
const BOUNDARY = /[\s.,!?;:)]/
const KEEP_REPEAT = new Set(['had', 'that', 'is', 'very', 'so', 'bye', 'no', 'ha', 'haha', 'knock'])

const matchCase = (found, fixed) => (found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()
  ? fixed[0].toUpperCase() + fixed.slice(1) : fixed)

const sentenceStart = (before) => before.trim() === '' || /([.!?]["')\]]?\s+|\n\s*)$/.test(before)

/**
 * Called after one character was typed at `caret` (the position just after it).
 * Returns { text, caret, fix: {from, to} } when something was corrected, else null.
 */
export function correctAtCaret(text, caret, names = NO_NAMES) {
  const typed = text[caret - 1]
  if (!typed || !BOUNDARY.test(typed)) return null
  let head = text.slice(0, caret - 1)  // everything before the boundary character
  const tail = text.slice(caret - 1)
  const original = head

  // "could of" → "could have" (whole phrase just finished)
  for (const [wrong, right] of PHRASES) {
    const re = new RegExp(`(^|[^A-Za-z'])(${wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})$`, 'i')
    const m = head.match(re)
    if (m) { head = head.slice(0, head.length - m[2].length) + matchCase(m[2], right); break }
  }

  const m = head.match(/([A-Za-z']+)$/)
  if (m) {
    const word = m[1]
    const start = head.length - word.length
    let fixed = word
    const known = WORDS[word.toLowerCase()]
    if (names.has(word.toLowerCase())) fixed = names.get(word.toLowerCase())  // people you write about: "roby" → "Roby"
    else if (known) fixed = matchCase(word, known)
    else if (word === 'i') fixed = 'I'
    else if (/^i'(m|ve|d|ll)$/.test(word)) fixed = 'I' + word.slice(1)
    // capital letter at the start of a sentence
    if (/^[a-z]/.test(fixed) && sentenceStart(head.slice(0, start))) fixed = fixed[0].toUpperCase() + fixed.slice(1)
    head = head.slice(0, start) + fixed
    // a word typed twice: "the the" → "the"
    const rep = head.match(/(^|[^A-Za-z'])([A-Za-z']+)\s+([A-Za-z']+)$/)
    if (rep && rep[2].toLowerCase() === rep[3].toLowerCase() && !KEEP_REPEAT.has(rep[3].toLowerCase())) {
      head = head.slice(0, head.length - rep[3].length).replace(/\s+$/, '')
    }
  }

  // no space before punctuation: "Lina ," → "Lina,"
  if (/[.,!?;:]/.test(typed) && / +$/.test(head)) head = head.replace(/ +$/, '')

  if (head === original) return null
  // what changed, for the "Corrected … · Undo" note: drop the words both versions share at the start
  const a = original.slice(-200).split(/\s+/), b = head.slice(-200 + (head.length - original.length)).split(/\s+/)
  while (a.length > 1 && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift() }
  while (a.length > 1 && b.length > 1 && a[a.length - 1] === b[b.length - 1]) { a.pop(); b.pop() }
  return { text: head + tail, caret: head.length + 1, fix: { from: a.join(' ').trim() || '␣', to: b.join(' ').trim() } }
}

/** Correct a whole text (used for pasted text before saving). */
export function correctAll(text, names = NO_NAMES) {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    out += text[i]
    const r = correctAtCaret(out, out.length, names)
    if (r) out = r.text
  }
  // the last word has no boundary after it yet
  const r = correctAtCaret(out + ' ', out.length + 1, names)
  return r ? r.text.slice(0, -1) : out
}

/** Map of lower-case first names → how they are written, from the owner's beneficiaries. */
export function nameMap(people) {
  const m = new Map()
  for (const p of people || []) {
    for (const part of (p.display_name || '').split(/\s+/)) {
      if (/^[A-Z][a-z'-]{1,}$/.test(part) && !WORDS[part.toLowerCase()]) m.set(part.toLowerCase(), part)
    }
  }
  return m
}
