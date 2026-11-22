# Extra features

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

Features we added on top of the six required components. None of them replaces a required component, and every one follows the access protocol: no feature lets a person or the AI see an entry the owner did not permit.

> **Handout condition 4:** each feature must be shown to the instructor for scope before it is built. Record here when and how that was done: [DATE / CHANNEL OF INSTRUCTOR APPROVAL].

| # | Feature | Paradigm | Why this paradigm | How it respects the access protocol | Tests |
|---|---|---|---|---|---|
| 1 | Web interface (React, owner and beneficiary views) | Declarative, component-based UI | Each screen is a function of its data; components are reused across pages | Shows only what the API returns; the API decides nothing on its own, Prolog does | Browser walkthroughs; API tests |
| 2 | Executor reports the owner's passing, with a waiting period (dead-man's-switch idea) | Event-driven, procedural service | A report starts a timer; due reports are processed on a schedule and on every request | Until the trigger fires, every beneficiary decision is `owner_alive` → nothing. The owner is emailed and can cancel | `test_executor.py` |
| 3 | Death-notice emails to beneficiaries | Procedural scripting | Composing and sending messages is a sequence of steps with retries | Emails say only how many letters and entries are waiting, decided by Prolog; never diary text | `test_death_notices.py` |
| 4 | Email verification and password reset by code | Procedural, with hashed one-time codes | A short, ordered security flow | Accounts cannot be used until verified; codes are hashed, expire and are rate-limited | `test_email_verification.py`, `test_password_recovery.py` |
| 5 | Groups in the policy language (e.g. `group family = maria, jose;`) | Language design + logic | A new statement in the grammar, compiled to `group_member/2` facts | Groups only widen what an `allow` names; `deny` still wins | `test_policy_language.py`, `test_prolog_rules.py` |
| 6 | "Who can read this after you're gone" on every entry | Logic (Prolog decisions shown to the owner) | Reuses the same `decision/5` the beneficiaries get | Read-only view for the owner of the decisions that will apply | `test_api_security.py::test_entry_access_lists_each_beneficiary` |
| 7 | Letter delivery check, with "Add to my policy" | Language design | Generates a valid `release letters to … after death;` statement and saves it as a new policy version | The letter still needs Prolog's release decision; the statement only reaches its recipient | `test_api_security.py::test_letter_release_check_and_add` |
| 8 | "Did he write about me?" counts and letters through the assistant | Scripting (two more AI tools) | New tools on the same permitted views | Counts only permitted entries; an unreleased letter's text never reaches the model | `test_handout_scenarios.py` |
| 9 | Autosaved drafts on the Write page | Event-driven UI state | Saving on change is a reaction to typing | Drafts stay in the browser, are never sent until sealed, and are erased on sign-out | Browser walkthrough |
| 10 | Hash-chained audit log | Functional hashing (same chain as entries) | Reuses the pure `link_hash` pipeline | Records who asked what and which entries were authorised and cited | `test_hashchain.py` |
| 11 | Fail-closed integrity gate | Procedural guard + functional verification | Recomputes the chains before releasing anything | A broken chain releases nothing (`TamperDetected`) | `test_typed_exceptions.py` |
| 12 | Owner preview: "ask as" a beneficiary | Scripting | Same pipeline, evaluated as if after the owner's passing | Shows the owner exactly what each person would get; beneficiaries never get previews | `test_ai.py::test_owner_preview_and_history` |
| 13 | In-browser demo edition (Python in WebAssembly, SWI-Prolog in WebAssembly) | Scripting / portability | The same backend and Prolog rules run in the browser with no server | Same code, same rules, same tests | Browser build |
| 14 | Free deployment (Docker, PostgreSQL, Render, Neon, Brevo) | Configuration | Same code on SQLite or PostgreSQL | Database triggers enforce append-only on both | Full suite on SQLite and PostgreSQL |
