import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, drafts } from './api'

const respond = (status, body) => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

beforeEach(() => { sessionStorage.clear(); localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('api errors are written for people', () => {
  it('no connection', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 0, message: "Can't connect to MMK. Check your internet connection and try again." })
  })
  it('server errors never show internal text', async () => {
    vi.stubGlobal('fetch', () => respond(500, { detail: 'Traceback: KeyError at line 42' }))
    await expect(api('/api/x')).rejects.toMatchObject({ status: 500, message: 'Something went wrong on our side. Try again in a moment.' })
  })
  it("MMK's own messages are passed on", async () => {
    vi.stubGlobal('fetch', () => respond(400, { detail: 'Your current password is incorrect.' }))
    await expect(api('/api/x')).rejects.toMatchObject({ message: 'Your current password is incorrect.' })
  })
  it('validation errors name the field', async () => {
    vi.stubGlobal('fetch', () => respond(422, { detail: [{ loc: ['body', 'title'], type: 'string_too_long', msg: 'too long' }] }))
    await expect(api('/api/x')).rejects.toMatchObject({ message: 'Title is too long.' })
  })
})

describe('drafts', () => {
  it('are kept on the device at once and sent to the server shortly after', async () => {
    vi.useFakeTimers()
    const calls = []
    vi.stubGlobal('fetch', (url, init) => { calls.push([url, init?.method]); return respond(200, {}) })
    drafts.put(1, { id: 'dtest1', form: { kind: 'text', text: 'Hello' } })
    expect(drafts.list(1)[0].form.text).toBe('Hello')
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1300)
    expect(calls).toEqual([['/api/drafts/dtest1', 'PUT']])
  })
  it('sync takes the newer copy and drops ones deleted on another device', async () => {
    sessionStorage.setItem('mmk.draft.1', JSON.stringify([
      { id: 'dold', form: { text: 'Deleted elsewhere' }, saved_at: '2026-01-01T00:00:00Z', synced: true },
      { id: 'dboth', form: { text: 'Older here' }, saved_at: '2026-01-01T00:00:00Z', synced: true },
    ]))
    vi.stubGlobal('fetch', () => respond(200, [{ id: 'dboth', form: { text: 'Newer on server' }, saved_at: '2026-02-01T00:00:00Z' }]))
    const list = await drafts.sync(1)
    expect(list.map((d) => d.form.text)).toEqual(['Newer on server'])
  })
})
