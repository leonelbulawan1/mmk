// Browser runtime: runs the real MMK backend inside this page.
//
//  * Python backend (FastAPI app, domain model, policy compiler, AI tools) -> Pyodide (CPython in WebAssembly)
//  * Access rules (access_rules.pl)                                        -> SWI-Prolog compiled to WebAssembly
//  * Database                                                              -> SQLite inside Pyodide, saved to this
//                                                                             browser's IndexedDB after each request
//
// Every request the React app makes to /api/... is handed to the FastAPI app through ASGI instead of the network.

const RUNTIME = new URL('./runtime/', document.baseURI).href
const DB_PATH = '/data/alaala.db'
const IDB_NAME = 'alaala-demo'

const PYODIDE_PACKAGES = ['pydantic', 'sqlalchemy', 'sqlite3', 'hashlib', 'ssl', 'anyio', 'sniffio', 'idna',
  'typing-extensions', 'annotated-types', 'tzdata']

// ---- tiny IndexedDB key/value store (per browser; failures are non-fatal) ----
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function kvGet(key) {
  try { const db = await idb(); return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
  catch { return undefined }
}
async function kvSet(key, value) {
  try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error) }) }
  catch { /* storage unavailable: the demo still works for this visit */ }
}
export async function resetDemo() {
  try { await new Promise((res) => { const r = indexedDB.deleteDatabase(IDB_NAME); r.onsuccess = r.onerror = r.onblocked = res }) } catch { /* ignore */ }
  try { sessionStorage.clear() } catch { /* ignore */ }
  location.reload()
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(s)
  })
}
// Archives are stored with an extra ".wasm" suffix (see scripts/build-web.sh); map requests back.
const realFetch = window.fetch.bind(window)
const served = (url) => (/\.(whl|zip)$/.test(url) ? url + '.wasm' : url)
window.fetch = (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
  return href && href.startsWith(RUNTIME) ? realFetch(served(href), init) : realFetch(input, init)
}
const bytes = async (url) => { const r = await realFetch(served(url)); if (!r.ok) throw new Error(`Could not load ${url}`); return new Uint8Array(await r.arrayBuffer()) }

let state = { persistent: false }
export const runtimeInfo = () => state

export async function boot(progress = () => {}) {
  // 1. SWI-Prolog (WebAssembly) with the access rules
  progress('Starting SWI-Prolog', 10)
  await loadScript(RUNTIME + 'swipl-bundle.js')
  const swipl = await window.SWIPL({ arguments: ['-q'] })
  swipl.FS.writeFile('/rules.pl', new TextDecoder().decode(await bytes(RUNTIME + 'access_rules.pl.txt')))
  swipl.prolog.query("consult('/rules.pl')").once()
  window.alaalaProlog = (facts, goal) => {
    try {
      swipl.FS.writeFile('/facts.pl', facts)
      const r = swipl.prolog.query(`unload_file('/facts.pl'), consult('/facts.pl'), with_output_to(string(S), (${goal}))`).once()
      if (!r || r.S === undefined) return '\u0000ERR:' + JSON.stringify(r)
      return String(r.S)
    } catch (e) { return '\u0000ERR:' + (e?.message || e) }
  }

  // 2. Python
  progress('Starting Python', 25)
  const { loadPyodide } = await import(/* @vite-ignore */ RUNTIME + 'pyodide/pyodide.mjs')
  const py = await loadPyodide({ indexURL: RUNTIME + 'pyodide/' })
  progress('Loading libraries', 45)
  await py.loadPackage(PYODIDE_PACKAGES)

  progress('Loading the MMK backend', 65)
  const manifest = await (await fetch(RUNTIME + 'manifest.json')).json()
  py.FS.mkdirTree('/tmp/pkgs')
  for (const w of manifest.wheels) py.FS.writeFile('/tmp/pkgs/' + w, await bytes(RUNTIME + 'wheels/' + w))
  py.FS.writeFile('/tmp/pkgs/backend.zip', await bytes(RUNTIME + 'backend.zip'))
  py.runPython(`
import os, site, sys, zipfile
sp = site.getsitepackages()[0]
for f in os.listdir('/tmp/pkgs'):
    if f.endswith('.whl'):
        zipfile.ZipFile('/tmp/pkgs/' + f).extractall(sp)
os.makedirs('/srv', exist_ok=True)
zipfile.ZipFile('/tmp/pkgs/backend.zip').extractall('/srv')
sys.path.insert(0, '/srv')
os.makedirs('/data', exist_ok=True)
`)

  // 3. Database: restore this browser's copy, or seed the fictional demo vault
  progress('Opening the vault', 80)
  let secret = await kvGet('jwt_secret')
  if (!secret) {
    secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
    await kvSet('jwt_secret', secret)
  }
  const saved = await kvGet('db')
  if (saved) py.FS.writeFile(DB_PATH, saved)
  const webrun = py.pyimport('app.webrun')
  progress(saved ? 'Verifying your saved vault' : 'Writing the demo diary (first visit only)', 88)
  webrun.boot(DB_PATH, secret)
  state = { persistent: (await kvGet('jwt_secret')) === secret, restored: !!saved }

  // 4. Route /api/* through FastAPI (ASGI), one request at a time
  let queue = Promise.resolve()
  // Save the SQLite file to IndexedDB after every request (reads also append audit records),
  // before the response is returned, so nothing is lost if the page is reloaded right away.
  const persist = async () => { try { await kvSet('db', py.FS.readFile(DB_PATH)) } catch { /* ignore */ } }
  const runtimeFetch = window.fetch
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    if (!url.pathname.startsWith('/api/')) return runtimeFetch(input, init)
    const run = async () => {
      const headers = {}
      new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v })
      const raw = await webrun.handle(init.method || 'GET', url.pathname, url.search.slice(1), JSON.stringify(headers),
        typeof init.body === 'string' ? init.body : '')
      const res = JSON.parse(raw)
      await persist()
      return new Response(res.body, { status: res.status, headers: res.headers })
    }
    const p = queue.then(run, run)
    queue = p.catch(() => {})
    return p
  }
  progress('Ready', 100)
  return state
}
