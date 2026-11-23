// Thin fetch wrapper.
// The session token lives in sessionStorage (cleared when the tab closes) unless the person
// ticked "Keep me signed in", in which case it is kept in localStorage until it expires or they sign out.
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '') // no trailing slash
const KEY = 'alaala.token'
const safe = (fn) => { try { return fn() } catch { return null } }

export const tokenStore = {
  get: () => safe(() => sessionStorage.getItem(KEY)) || safe(() => localStorage.getItem(KEY)),
  remembered: () => !!safe(() => localStorage.getItem(KEY)),
  set: (t, remember = false) => {
    safe(() => sessionStorage.removeItem(KEY))
    safe(() => localStorage.removeItem(KEY))
    if (t) safe(() => (remember ? localStorage : sessionStorage).setItem(KEY, t))
  },
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : detail?.message || 'Request failed')
    this.status = status
    this.detail = detail
  }
}

function formatDetail(detail) {
  if (Array.isArray(detail)) return detail.map((d) => d.msg?.replace(/^Value error, /, '') || 'Invalid input').join(' ')
  return detail
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && token) {
      tokenStore.set(null)
      window.dispatchEvent(new Event('alaala:logout'))
    }
    throw new ApiError(res.status, formatDetail(data?.detail) || res.statusText)
  }
  return data
}

export const fmtDate = (iso) =>
  iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''

export const today = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// Unsaved Write-page drafts, one per user. Kept where the session token is kept: in sessionStorage
// (gone when the tab closes) unless "Keep me signed in" was ticked. Signing out removes them.
const DRAFT = 'mmk.draft.'
// Unfinished writing, kept on this device only (never sent to the server until saved).
// Several drafts per user: [{ id, form, mode, saved_at }], newest first.
const readDrafts = (uid) => {
  const raw = safe(() => sessionStorage.getItem(DRAFT + uid)) || safe(() => localStorage.getItem(DRAFT + uid))
  let v = null
  try { v = raw ? JSON.parse(raw) : null } catch { v = null }
  if (!v) return []
  if (!Array.isArray(v)) v = v.form ? [{ id: 'd' + Date.now(), ...v }] : []  // older single-draft format
  return v.filter((d) => d && d.id && d.form && (d.form.text?.trim() || d.form.title?.trim()))
}
const writeDrafts = (uid, list) => {
  safe(() => sessionStorage.removeItem(DRAFT + uid)); safe(() => localStorage.removeItem(DRAFT + uid))
  if (!list.length) return
  const store = tokenStore.remembered() ? localStorage : sessionStorage
  store.setItem(DRAFT + uid, JSON.stringify(list))  // may throw when storage is full or blocked
}
export const newDraftId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
export const drafts = {
  list: (uid) => readDrafts(uid).sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || '')),
  get: (uid, id) => readDrafts(uid).find((d) => d.id === id) || null,
  put: (uid, draft) => {
    const list = readDrafts(uid).filter((d) => d.id !== draft.id)
    writeDrafts(uid, [{ ...draft, saved_at: new Date().toISOString() }, ...list])
  },
  remove: (uid, id) => writeDrafts(uid, readDrafts(uid).filter((d) => d.id !== id)),
  clearAll: () => {
    for (const store of [safe(() => sessionStorage), safe(() => localStorage)]) {
      if (!store) continue
      safe(() => Object.keys(store).filter((k) => k.startsWith(DRAFT)).forEach((k) => store.removeItem(k)))
    }
  },
}
// Kept for older imports: the newest draft.
export const draftStore = { get: (uid) => drafts.list(uid)[0] || null, clearAll: () => drafts.clearAll() }
