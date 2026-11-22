# MMK system audit and improvement plan

Date: 22 November 2026. Scope: the code on GitHub (`backend/` FastAPI + SQLAlchemy + SWI-Prolog, `frontend/` React + Vite + Tailwind), deployed on Render with Neon PostgreSQL.

## A. What exists today (verified in the code)

| Module | What it does now |
|---|---|
| Authentication | Email + password, 6-digit email verification, password reset by code, JWT sessions (short, or "Keep me signed in"), sign-out of every device on a password change (`token_version`). Beneficiaries activate with a one-time invite code. |
| Dashboard | Real counts from `/api/dashboard`: entries, recent entries, beneficiaries, vault status. No placeholder numbers. |
| Diary entries | Search (title, text, topic), type filter, "Needs review" filter, timeline grouped by year, entry page with original, revisions and a diff. |
| Write | Email-style composer: Diary/Letter, To, Subject, Date, Opens, lined-paper editor, Verbatim / Light Fix / Review, Preview, word count, local draft. |
| Preservation | Entries and revisions are append-only, hash-chained, and protected by database triggers; a revision never replaces the original. |
| Beneficiaries | Add, address check, invitation email, bounce detection, fix email, deactivate, executor. |
| Legacy policy / Access permissions | Own policy language (lexer, parser, interpreter) compiled to Prolog; versioned; "who can read what" table computed by Prolog. |
| AI assistant | Tool-using assistant limited to what Prolog allows; leak guard; citations; offline provider by default (`LLM_PROVIDER=offline`), so no text leaves the server. |
| Vault integrity | Re-computes every hash in the entry, revision and policy chains; JSON export. |
| Letters | On a date (delivered while alive) or after death; email + recipient home page. |

The writing modes (Light Fix, Review) run in `processing/pure.py` on the MMK server. They do not call an external AI service.

## B. Findings

Severity: **Critical** = security or data loss; **High** = broken or misleading behaviour; **Medium** = usability/accessibility; **Low** = polish.

| # | Severity | Module | Finding | Fix | Status |
|---|---|---|---|---|---|
| 1 | Critical | Authentication | No limit on wrong passwords: a password can be guessed without end (failures were only logged). | Lock sign-in for an email after 5 failures in 15 minutes, and for a network address after 20; same for invite activation. Counted in memory (MMK runs one server process); a restart clears the counts. | Fixed |
| 2 | High | Performance | Every signed-in request ran `process_due`, which every 10 minutes also ran Prolog for every owner to look for opened letters, inside a user's request. | Requests only check due executor reports (cheap, at most every 20 s); the letter sweep runs in the background loop and on `/api/health`. | Fixed |
| 3 | High | Security | API responses had no browser security headers. | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` on API responses; the website's headers in `render.yaml` (applied by Render to the static site). | Fixed |
| 4 | High | Write | "Save" saved straight away, although a saved entry can never be edited or deleted. | Save opens a final check (full preview, what happens next); the entry is saved only after "Save permanently". | Fixed |
| 5 | High | Vault integrity | If the check could not run (network/server), the page showed only an error; "Tampered" wording was alarming. | States: Verified, Verification failed, Unable to verify (with retry). | Fixed |
| 6 | Medium | Write | Draft status was a bare "Draft saved"; no character count, reading time or time of save. | Status line: "Draft saved on this device · 6:31 PM", words, characters, reading time. | Fixed |
| 7 | Medium | Write | No focus mode, no text size control, no keyboard shortcut. | Focus mode (full screen), text size A− / A+, Ctrl/⌘+S to save, Esc to leave focus mode. | Fixed |
| 8 | Medium | Navigation | Sign out had no confirmation; sidebar could not be collapsed. | Confirmation dialog; collapsible sidebar with labels shown as tooltips (remembered per browser). | Fixed |
| 9 | Medium | Diary entries | No sort order; all entries rendered at once. | Newest/oldest sort; 30 at a time with "Show more". | Fixed |
| 10 | Medium | Accessibility | Animations ignored "reduce motion"; dialogs had no shared accessible component. | `prefers-reduced-motion` support; one `ConfirmDialog` (role="dialog", aria-modal, Esc, focus on open, focus returned). | Fixed |
| 11 | Medium | Performance | One 366 kB JavaScript bundle for every page. | Pages are loaded on demand (`React.lazy`). | Fixed |
| 12 | Low | Dashboard | An unfinished draft was only visible on the Write page. | "Continue your draft" card when a draft exists in this browser. | Fixed |
| 13 | Low | Security | Session token is kept in browser storage (sessionStorage, or localStorage with "Keep me signed in"). An XSS bug could read it. React escapes output and no HTML is rendered from user text, so the risk is low. | Keep; moving to HttpOnly cookies needs CSRF protection and is listed as future work. | Known limitation |
| 14 | Low | Drafts | Drafts are stored only in this browser, not on the server. | Kept on purpose: an unfinished draft never leaves the device, and there are no autosave API calls. Documented in the composer. | By design |

Checked and found correct: every owner route uses `require_owner`; every entry query is filtered by the signed-in owner; beneficiaries only receive what Prolog decides; passwords are hashed (bcrypt via `security_hashing`); codes are stored as hashes with expiry and attempt limits; `JWT_SECRET` is generated by Render; private text is never written to logs (email logs show the address and the error only).

## C. Plan

* **Critical / High (done in this round):** 1–5.
* **Medium (done in this round):** 6–12.
* **Optional, later:** HttpOnly cookie sessions with CSRF tokens; account export as a readable PDF; account closure process that respects the preservation rule (needs a written policy first); writing prompts and mood tags; dark theme; server-side encrypted drafts.

## D. Database and API changes

* No new tables and no migration. The login limit is kept in memory (`services/attempts.py`).
* New response field: none. New status code: `429` from `/api/auth/login` and `/api/auth/activate` when too many attempts were made, with a plain message.

## E. Tests

See `docs/TESTING.md`. New: `tests/test_login_limits.py`, `tests/test_security_headers.py`.

### Results of this round (executed)

* Backend: **225 automated tests passed, 0 failed** (SQLite). The letter, email and access-table tests also passed on PostgreSQL.
* Frontend: production build succeeds; signed-in pages now load as separate files (main file 287 kB, was 366 kB).
* Browser check (Playwright, Chromium) at 1366×860 and 390×844: Write page, final-check dialog, save, Diary entries with "Show more" and oldest-first sort, collapsed sidebar with tooltip, sign-out dialog, focus mode on a phone. No JavaScript errors; no horizontal scrolling on the phone.
* Not tested: screen readers (only the markup was checked), Safari, real email delivery from Render, behaviour after Render restarts the server.

### Files changed

Backend: `app/services/attempts.py` (new), `app/routers/auth.py`, `app/services/death.py`, `app/security.py`, `app/main.py`, `tests/test_login_limits.py` (new), `tests/conftest.py`.
Frontend: `components/ui.jsx` (Dialog, ConfirmDialog), `components/Layout.jsx`, `components/NavIcon.jsx`, `pages/CreateEntry.jsx`, `pages/Entries.jsx`, `pages/Dashboard.jsx`, `pages/VaultIntegrity.jsx`, `App.jsx`, `index.css`.
Config: `render.yaml` (website security headers). No database migration.
