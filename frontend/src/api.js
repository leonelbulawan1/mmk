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
