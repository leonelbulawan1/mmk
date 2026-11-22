# Architecture

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

```
React (Vite, Tailwind, Router)
        │  JSON over HTTPS, Bearer JWT
        ▼
FastAPI routers ── security.py (JWT, role dependencies)
        │
services/ ─────────────── audit.py (hash-chained audit log)
  vault_service   ── maps rows ⇄ domain objects, appends entries/revisions
  policy_service  ── compiles policies, appends versions, builds AccessEngine
  qa_service      ── Prolog decisions FIRST → AuthorizedContext → Assistant
        │                         │                       │
domain/ (OOP)            prolog/engine.py ──► swipl + access_rules.pl
processing/ (pure FP)    policy_lang/ (lexer → parser → interpreter → Prolog)
writing_modes.py         ai/ (tools, providers, assistant, leak guard)
        │
SQLAlchemy models ── SQLite (dev) / Firebase Data Connect PostgreSQL (prod)
```

## A. Object-oriented diary model (`app/domain`)

| Class | Responsibility | OOP features |
|---|---|---|
| `Person` (abstract) | Identity and password verification | Name-mangled `__password_hash`; abstract `role` and `permissions()` |
| `Owner(Person)` | Death-trigger state, owner permissions | `permissions()` overridden: becomes read-only after the trigger |
| `Beneficiary(Person)` | Handle, relationship, active flag | `permissions()` overridden |
| `Entry` (abstract) | Immutable entry: read-only properties, `with_revision()` returns a new object | Encapsulation: all state is private |
| `TextEntry(Entry)` | Ordinary diary entry | `kind` |
| `LetterEntry(Entry)` | Recipient, release date / on death | Overrides `hash_payload()` and `render()` (letters are all-or-nothing) |
| `Revision` | Frozen dataclass for an appended correction | Immutable |
| `Vault` | Append-only collection; computes hashes; `verify()`; `seal()` | Encapsulation (no removal API) |
| `Protocol` | Ordered rules of the compiled policy; `freeze()`; `replace()` refuses once frozen | |
| `Rule` → `Grant`, `Denial`, `LetterRelease`, `Group` | Each rule translates itself to Prolog | Polymorphic `to_prolog()` and `describe()` |
| `Filter` / `Condition` subclasses | `TopicFilter`, `MentionFilter`, `FromFilter`, `UntilFilter`; `Always`, `AfterDate`, `AfterDeath` | Polymorphic `to_prolog()` |

`Entry.render(level)` is the single place that decides what each access level reveals:
- `existence` → id, date, kind
- `summary` → adds the summary and topics computed when the entry was written
- `verbatim` → adds the title and text

## B. Functional processing (`app/processing/pure.py`, `hashchain.py`)
`normalize`, `extract`, `correct`, `diff`, `apply_diff`, `revert_diff`, `summarize`, `link_hash` and `verify_chain` are pure. They take values and return new frozen dataclasses, tuples or frozensets. They do no I/O and change nothing they are given. Lexicons are `MappingProxyType` (read-only).

**Append-only storage** is enforced in three ways:
1. SQLAlchemy `before_update` / `before_delete` listeners raise.
2. Database triggers (SQLite or PostgreSQL) abort UPDATE and DELETE on `entries`, `revisions`, `policy_versions` and `audit_log`.
3. Hash chaining: `hash = SHA-256(prev_hash ‖ canonical_json(payload))`. There is one chain per owner across entries and revisions (ordered by `seq`), one for policy versions and one for the audit log. Changing, deleting or reordering any record breaks verification. This catches tampering that bypasses 1 and 2 (proved by `test_tampering_that_bypasses_guards_is_detected`).

## C. Writing modes (`app/writing_modes.py`)
`WritingMode` is an abstract strategy with a `process(original) -> ModeResult` method. The service calls `get_mode(key).process(...)` and never branches on the mode name.
- **Verbatim**: no revision.
- **Light Fix**: `correct()` runs and the result is appended as a `light_fix` revision.
- **Review**: `diff()` suggestions are shown. Accepting them appends a `review` revision.

In every mode the original text is the immutable entry itself.

## D. Prolog access rules
See `app/prolog/access_rules.pl` and `docs/SECURITY.md`. Python writes one fact file per query. It holds only metadata: entry ids, dates, topics, names, letter recipients and conditions, the policy rules, beneficiaries and the death and frozen flags. **No entry text is ever sent to Prolog.**

## E. Legacy Policy Language
See `docs/POLICY_LANGUAGE.md`.

## F. Grounded AI (`app/ai`)
1. `qa_service.build_context` asks Prolog for decisions for this beneficiary **before reading any content**.
2. `AuthorizedContext.build` renders each permitted entry at its permitted level and drops the full entry objects. Letters are excluded; they are read on the Letters page.
3. The model gets three tools: `search_entries` (ids, dates and levels only), `check_access` and `get_entry`. A denied entry and a non-existent entry return the same response.
4. `LeakGuard` holds SHA-256 fingerprints of every sentence the beneficiary is *not* allowed to see. It inspects every message (including the strings inside tool-result JSON) before it goes to the model, and inspects the final answer. If anything matches, the request is aborted with a neutral answer and the event is audited.
5. Citations in the `[YYYY-MM-DD]` format are kept only if they match an entry whose content (summary or verbatim) was actually retrieved. Other citations are removed and reported.
6. If no entry is authorised, the model is never called.
