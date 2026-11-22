# MMK legacy features: current architecture, gaps and plan

22 November 2026. Based on the code in this repository (see also `docs/AUDIT.md`, `ARCHITECTURE.md`, `SECURITY.md`).

## 1. How MMK works today

```
React (Vite, Tailwind) on Render static ──HTTPS/JSON──▶ FastAPI on Render (Docker, 1 process)
                                                         ├─ SQLAlchemy ─▶ Neon PostgreSQL (SQLite in tests)
                                                         ├─ SWI-Prolog: every access decision
                                                         ├─ policy language (lexer → parser → interpreter → Prolog facts)
                                                         ├─ AI assistant (tools + leak guard; offline / Anthropic / OpenAI)
                                                         ├─ email: Gmail relay (Apps Script) ▸ Brevo API ▸ SMTP
                                                         └─ background loop every 60 s (+ /api/health for cron-job.org)
```

| Area | What exists (verified in code) |
|---|---|
| Accounts | Owner (email + password, email verification, reset, attempt limits) and beneficiary (invited by the owner, one-time code). JWT sessions. |
| Preservation | Entries, revisions, policy versions and the audit log are append-only and hash-chained; database triggers refuse updates and deletes. |
| Permissions | Default deny. The owner's legacy policy is compiled to Prolog; levels existence < summary < verbatim; deny beats allow; dates; letters only to their recipient; nothing while alive (except letters the owner sends on a date). |
| Death | `DeathReport`: the named **executor** (a beneficiary) reports; a waiting period runs; the owner is emailed and can cancel by signing in; then the death trigger seals the vault and the policy takes effect. Owner can also trigger it with a password. |
| Letters | "On a date" (even while alive) or "After my death"; delivered to the beneficiary's home page + an email that links to it (letter text is not in the email). |
| AI | Beneficiary questions → Prolog decides what is allowed → only allowed text is given to the model through tools → citations checked → leak guard. Says it is an AI; never speaks as the owner. Default provider is offline (no data leaves the server). |
| Email | Outbox table `email_notices`; invitation, death notice, letter released, codes; bounce check (Brevo). |

## 2. The request compared with the system

| Request | Status | Notes |
|---|---|---|
| Legacy preparation, per-beneficiary permissions, default deny, backend enforcement | **Exists** | Prolog decisions; "Access permissions" page shows what each person will get. |
| Death reporting with evidence + administrator review (ACTIVE → DEATH_REPORTED → UNDER_REVIEW → VERIFIED → LEGACY_ACTIVE, DISPUTED/REJECTED) | **Partial** | Today: executor report + waiting period + owner can cancel. No evidence upload, no administrator role, no dispute. Needs a decision (§4). |
| Gmail delivery with retries, idempotency, job locking, crash recovery | **Done in this phase** (§3) | Through the Gmail relay (sends from a real Gmail account) or Brevo. |
| Gmail **API** with OAuth | **Not yet** | See §5: works, but has a token-expiry trap on Google's "Testing" apps. |
| Letter schedules: N days after activation, anniversaries | **Missing** | Needs new release options; planned for phase 3. |
| Letter text inside the email | **By design not** | Only a link. Could become a per-letter choice the owner makes (with a warning). |
| AI with retrieval limited to permitted content and citations | **Exists** | Tool-based retrieval over Prolog-authorized views (works like RAG without a vector store; the diary is small). A real model is used when `LLM_PROVIDER=anthropic` or `openai` and a key is set. |
| Answering questions sent by email | **Kept disabled** | An email address is not proof of identity and email is easy to spoof; answers would leave the secure portal. Requirements to enable it safely are in §6. |
| Separate test environment that never emails real people | **Done in this phase** | `EMAIL_MODE=sandbox` + `EMAIL_ALLOWLIST`. |
| Consent screens (AI use, beneficiary access, posthumous release) | **Partial** | Disclaimers exist; an explicit consent record is planned for phase 3. Legal review is needed for the Data Privacy Act of 2012; nothing here claims compliance. |

## 3. Phase completed now: reliable email outbox

* **One attempt immediately, then automatic retries** for temporary problems (network, 5xx, rate limit) after 1, 5, 30 and 120 minutes; the 5th failure is final. Permanent refusals (bad key, bad address, 4xx) are not retried.
* **Claiming**: the background runner takes a due email with a conditional update (`retrying → sending`), so two runners never send the same email.
* **Crash safety**: an email stuck in `sending` for 10 minutes becomes `unknown` ("may or may not have been delivered") and is **not** resent automatically; the owner decides ("Send anyway").
* **Idempotency**: each letter email has the key `letter:<beneficiary>:<entry>` with a unique index, so a letter is emailed to its recipient at most once even if sweeps overlap.
* **Honest statuses**: "Accepted for delivery" (the provider took it; not proof it was read), "Delivered"/"Address does not exist" (only when Brevo reports it), "Will retry · next try 7:05 PM", "Check before resending", "Not sent (test mode)".
* **Test mode**: `EMAIL_MODE=sandbox` emails only `EMAIL_ALLOWLIST` addresses (`a@b.com`, or `@domain` for a whole domain).
* Database: two new nullable columns on `email_notices` (`next_attempt_at`, `idempotency_key`) and two indexes, added automatically at start-up. Nothing is dropped or rewritten.
* Tests: `tests/test_outbox.py` (7 tests), on SQLite and PostgreSQL.

## 4. Death verification: proposed design (needs your decision)

Proposed states, stored on a new `legacy_cases` table linked to the existing `death_reports`:

```
ACTIVE ─report─▶ DEATH_REPORTED ─reviewer opens─▶ UNDER_REVIEW ─approve─▶ VERIFIED ─waiting period ends,
   ▲                    │                              │  ╲reject▶ REJECTED        no dispute─▶ LEGACY_ACTIVE
   └──── owner cancels ─┘                              └──dispute▶ DISPUTED ─resolve▶ UNDER_REVIEW
```

* Evidence (death certificate scan) stored in the database as an encrypted blob, max 5 MB, PDF/JPEG/PNG only, never public; Render's free plan has no persistent disk.
* Reviewer = a new `admin` role, created from the command line only (never from the website). Approval needs the reviewer's password again; every transition is one database transaction with a version check, and is written to the hash-chained audit log.
* The owner is emailed at every step and can still cancel until LEGACY_ACTIVE; any beneficiary can dispute during the waiting period.
* AI is never part of this decision.

## 5. Gmail API option

Requirements: a Google Cloud project, Gmail API enabled, OAuth consent screen, scope `https://www.googleapis.com/auth/gmail.send` only, a dedicated MMK Gmail account authorized once by an administrator, refresh token stored encrypted in the database (key in `GMAIL_TOKEN_KEY`), env `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
Trap: while the Google app is in **Testing** status, refresh tokens expire after 7 days and sending stops. The app must be set to **In production** (unverified apps are allowed for the owner's own account, with a warning screen). The current Apps Script relay avoids this and already sends from a real Gmail account, so it remains the recommended free option; the Gmail API can be added behind the same outbox.

## 6. Email questions (kept off)

To enable safely it would need: signed reply addresses per conversation (`reply+<token>@`), checking the SPF/DKIM result of every incoming message, matching to an activated beneficiary, rate limits, and answers that contain only a link to the portal (no diary text in email). Incoming text is treated as untrusted data, never as instructions. Recommended: keep questions in the authenticated portal.

## 7. Environment variables

| Variable | Purpose |
|---|---|
| `EMAIL_MODE` | `live` (default) or `sandbox` |
| `EMAIL_ALLOWLIST` | addresses/domains that sandbox mode may email |
| `GMAIL_RELAY_URL`, `GMAIL_RELAY_SECRET` | Gmail sender via Apps Script (docs/deploy/GMAIL_RELAY.md) |
| `BREVO_API_KEY`, `SMTP_*`, `SMTP_FROM` | other email options |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | `offline` (default), `anthropic` or `openai` |
| `APP_TIMEZONE` | default `Asia/Manila` |

## 8. Next phases (in order)

1. **Death verification with review** (§4), after your decisions.
2. **Letter schedules**: "N days after activation", "every year on a date"; owner's per-letter choice "include the letter text in the email".
3. **Consent records** for AI use and posthumous release, shown in Settings with a revoke option while alive.
4. **Gmail API** sender (§5), optional.
5. **Beneficiary portal polish**: suggested questions, conversation history, notification preferences.
