# Project Proposal and Final System Requirements

**MMK (Maalaala Mo Kaya): our build of Alaala, a personal AI diary**

CS 413 Programming Languages · Final Project · Task 1.03

> **Team:** [MEMBER 1 FULL NAME] (Front End) · [MEMBER 2 FULL NAME] (Back End) · [MEMBER 3 FULL NAME] (Q/A) · [MEMBER 4 FULL NAME] (UI/UX Designer) · [MEMBER 5 FULL NAME] (Documentator)

| | |
|---|---|
| Task | 1.03 Prepare Project Proposal and Finalize System Requirements |
| Owner | Documentator (lead), Back End, UI/UX Designer |
| Version | 1.0 (final requirements baseline) |
| Status | **For team review.** Becomes the baseline when all five members sign section 16 |
| Kaneo task | [LINK TO KANEO TASK 1.03] |
| Repository | this file: `docs/PROPOSAL.md` |

This document is the **reference for all later design, coding and testing**. Any change to a requirement after approval is recorded in section 17 (change log) and agreed by the team.

All people, entries and letters in this document are **fictional** (owner *Juan Santos*, beneficiaries *Maria Santos* and *Adam Santos Jr*; demo owner *Elena Ramos*).

---

## 1. Problem

People keep diaries for years, but when they die, the diary is either lost or read all at once by whoever finds it. The writer has no say in **who** may read **what**, or **when**. Families are left with questions ("Did Papa ever write about me?", "What did he think when I graduated?") that nobody can answer, or with private pages they were never meant to see.

A plain shared folder or cloud document cannot solve this: it is all-or-nothing, it cannot release a letter on a future birthday, and it cannot answer questions without exposing everything.

## 2. Purpose

MMK is a private diary that:

1. keeps a person's entries **exactly as written**, for years, in a tamper-evident record;
2. lets the owner state, in a small **Legacy Policy language**, who may know about which entries, at what level (that an entry exists, a summary, or the full text), and from when;
3. shares **nothing while the owner is alive**; after the owner's death is confirmed, it applies the policy;
4. lets registered family and friends **ask an AI questions** about the owner's recorded life, answered **only from entries they may see**, with the date of each entry cited, and an honest "nothing I can share" when there is no permitted record.

The course goal is to show that each part of a real system uses the **programming paradigm that fits it**, and to defend those choices.

## 3. Objectives

| # | Objective | Measured by |
|---|---|---|
| O1 | Deliver all six required components, each in its required paradigm | Section 7; `docs/DESIGN_REPORT.md` |
| O2 | No person and no AI call ever receives an entry the owner did not permit | Access test table (`docs/ACCESS_TEST_TABLE.md`), leak tests |
| O3 | Behave exactly as the handout's sample cases (Maria's questions) | `backend/tests/test_handout_scenarios.py` |
| O4 | A working web prototype that others can run and try | README setup, live deployment |
| O5 | Documented, critically verified use of AI tools | `docs/AI_USE_LOG.md` |

## 4. Users

| User | Who they are | What they can do | What they can never do |
|---|---|---|---|
| **Owner** | The person writing the diary (one owner per diary) | Register, write entries and letters, choose writing modes, add beneficiaries, write and test the legacy policy, preview what each person will see, choose a trustee, start the death trigger, verify the vault | Edit or delete an entry after saving (only add revisions); change the policy after the death trigger |
| **Registered asker** (beneficiary) | A family member or friend the owner registered by email | Activate their account; **after the death trigger**: ask the AI, read the letters released to them | See anything while the owner is alive; see any entry or letter the policy does not permit; learn whether hidden entries exist |
| **Trustee** (called *Executor* in the app) | One registered asker chosen by the owner to confirm the owner's passing | Report the owner's passing (password + confirmation phrase); withdraw the report | Read anything extra because of this role; skip the waiting period; act for an owner who cancels |
| *Unregistered person* | Anyone else | Nothing but the sign-in page | Any diary content |

There is no administrator who can read diaries. The operator of the server manages hosting only.

## 5. Scope

### 5.1 In scope

**Core (the six required components):** diary model, entry processing, writing modes, access rules, Legacy Policy language, grounded AI Q&A (section 7).

**Features of MMK built around the core:**

| Area | Features |
|---|---|
| Accounts | Owner sign-up with email verification code; sign-in with "Keep me signed in"; password reset by emailed code; beneficiary activation link |
| Writing | Email-style composer (To, Subject, Date, Opens); diary entries and letters; Verbatim / Light Fix / Review with live preview; autosaved drafts (cleared on sign-out); no future dates |
| Reading | Timeline of entries by year, search as you type, filter by kind and theme, "Needs review" filter; entry detail with original, current text and revision history |
| Sharing control | Legacy policy editor with live validation, Prolog preview and samples; groups (e.g. `family`); Access permissions matrix; "Who can read this after you're gone" on every entry; letter delivery check with "Add to policy" |
| After death | Trustee reports the passing → waiting period (14 days by default) → owner can cancel → death trigger; policy frozen; emails to beneficiaries (count and link only, never content) |
| Asking | AI assistant with dated citations; "Did he write about me?" counts; letters through the assistant when released; owner preview "ask as" a beneficiary |
| Trust | Hash-chained entries, policy versions and audit log; integrity gate that stops all sharing if a chain breaks; audit of every question |
| Delivery | Responsive web app; free deployment (Render, Neon PostgreSQL, Brevo email); in-browser demo edition |

### 5.2 Out of scope

| Item | Why |
|---|---|
| A **legal will**, estate planning, transfer of property, or legal advice | Not a legal will (section 12) |
| Proving a death with official documents (death certificates, government records) | The trustee's report + waiting period + owner cancel is the mechanism |
| Voice, photo or document entries | Text only for this term (possible extra) |
| Splitting the vault key among trustees; end-to-end encryption at rest | Listed as future work |
| A mobile app in an app store | The web app is responsive and works on phones |
| More than one owner per diary, or shared diaries | One owner per diary |
| `transfer custody … if trustee unavailable` and `default writing mode` as **policy statements** | Handled outside the language (trustee setting; Settings default mode); future work (section 17) |
| Real people's diaries or personal data | Fictional data only |
| Payment, subscriptions, advertising | Not needed for the course |

## 6. System overview

```
 Owner (web) ──► FastAPI ──► Vault (OOP) ──► pure pipeline (FP) ──► append-only DB + hash chain
                   │
                   ├──► Policy text ─► lexer ─► parser ─► interpreter ─► Prolog facts
                   │
 Asker (web) ──► FastAPI ──► Prolog decides first ──► permitted views only ──► AI model + tools
                                                                     └──► leak guard ─► answer + citations
```

Stack: React + Vite + Tailwind (frontend); Python FastAPI + SQLAlchemy (backend); SQLite or PostgreSQL; SWI-Prolog; an LLM with tool calling (built-in offline model by default; Anthropic or OpenAI-compatible optional).

## 7. The six required components

| # | Component | Paradigm | Delivers |
|---|---|---|---|
| C1 | Diary model | Object-oriented | `Owner`, `Beneficiary` (from `Person`); `Entry` → `TextEntry`, `LetterEntry`; `Revision`; `Vault`; `Protocol` with rules (`Grant`, `Denial`, `Group`, `LetterRelease`). Inheritance, polymorphism (`render(level)`, `to_prolog()`), encapsulation (read-only fields; changes only through the vault) |
| C2 | Entry processing | Functional | Pure functions over immutable data: `normalize`, `extract` (names, topics), `correct`, `diff`. Entries append-only and hash-chained |
| C3 | Writing modes | Object-oriented | `VerbatimMode`, `LightFixMode`, `ReviewMode` chosen by polymorphism; the original is always kept |
| C4 | Access rules | Logic (Prolog) | Deny by default, deny beats allow, levels, release dates, nothing while alive, letters only to their recipient, frozen policy after the death trigger |
| C5 | Legacy Policy language | Language design | EBNF grammar, lexer, recursive-descent parser, interpreter that compiles to Prolog facts; 4 statement types (`group`, `allow`, `deny`, `release letters`); 3 sample programs |
| C6 | Grounded AI Q&A | Scripting | Answers only from permitted entries, cites dates, says so when there is no record; hidden entries never reach the AI |

## 8. Functional requirements

Priority: **M** = Must, **S** = Should, **C** = Could. Every *Must* is covered by an automated test or a demo step (section 15).

### 8.1 Accounts and roles

| ID | Requirement | Pri |
|---|---|---|
| FR-A1 | An owner can register with name, email and password; the account is usable only after entering a 6-digit code sent to that email | M |
| FR-A2 | Users sign in with email and password; "Keep me signed in" keeps the session for 30 days, otherwise it ends with the browser tab | M |
| FR-A3 | A user can reset a forgotten password with a 6-digit code sent by email; resetting signs out every device | M |
| FR-A4 | The owner registers beneficiaries (name, email, handle, relationship); each is emailed an invitation with a one-time activation link and code; if email cannot be sent, the owner is shown the link and code to pass on | M |
| FR-A5 | Owner-only pages are refused to beneficiaries, and beneficiary pages to owners | M |

### 8.2 Diary model and entry processing (C1, C2)

| ID | Requirement | Pri |
|---|---|---|
| FR-D1 | The owner writes **diary entries** (title optional, date, text) and **letters** (recipient, title, date, release: after death and/or on a date) | M |
| FR-D2 | The date of a memory cannot be in the future | M |
| FR-D3 | Saved entries are never edited or deleted; a correction is a new **revision**; the original is always kept | M |
| FR-D4 | Each entry is processed by `normalize → extract → correct → diff`, all pure functions | M |
| FR-D5 | Names and topics are extracted automatically and used for search and for policy filters | M |
| FR-D6 | Every entry and revision is linked in a SHA-256 hash chain; the owner can verify the whole chain | M |
| FR-D7 | The owner can list, search (as they type), filter (kind, theme, needs review) and open entries, and see the original, current text and revision history | M |
| FR-D8 | Drafts are saved in the browser while writing and restored if the page is left; they are erased on sign-out | S |

### 8.3 Writing modes (C3)

| ID | Requirement | Pri |
|---|---|---|
| FR-W1 | **Verbatim** stores the text exactly as typed | M |
| FR-W2 | **Light Fix** stores the original and adds a revision with small fixes (typos, spacing, capitals) | M |
| FR-W3 | **Review** stores the original and shows suggested fixes; nothing changes until the owner accepts | M |
| FR-W4 | The mode is chosen per entry (default from Settings); a live preview shows what the mode would do | M |

### 8.4 Access rules (C4)

| ID | Requirement | Pri |
|---|---|---|
| FR-R1 | **Deny by default:** anything no rule allows is hidden | M |
| FR-R2 | **Deny beats allow:** an explicit deny overrides every allow for the same entry | M |
| FR-R3 | Levels: *existence* (date only), *summary* (summary and topics), *verbatim* (full text); the highest permitted level applies | M |
| FR-R4 | Grants and letter releases can start **on a date** or **after death** | M |
| FR-R5 | **Nothing is shared while the owner is alive**, whatever the policy says | M |
| FR-R6 | A letter reaches **only its recipient**, only when its own release and a `release letters` rule allow it | M |
| FR-R7 | After the death trigger the policy is **frozen** (checked by Prolog and by the domain model) | M |
| FR-R8 | Every decision returns a reason (rule and line, deny, default deny, pending date) shown to the owner | M |
| FR-R9 | If Prolog is unavailable or errors, nothing is shared (fail closed) | M |
| FR-R10 | The owner sees, for every entry, who will be able to read it and why | S |

### 8.5 Legacy Policy language (C5)

| ID | Requirement | Pri |
|---|---|---|
| FR-P1 | The grammar is documented in EBNF (`backend/app/policy_lang/grammar.ebnf`) | M |
| FR-P2 | At least four statement types: `group`, `allow`, `deny`, `release letters`; filters `about`, `mentioning`, `from`, `until`; conditions `after <date>`, `after death` | M |
| FR-P3 | A lexer, a recursive-descent parser and an interpreter compile a program to Prolog facts | M |
| FR-P4 | Errors give the line and column and a plain message; an invalid program is never saved (`PolicySyntaxError`) | M |
| FR-P5 | Each saved policy is a new, hash-chained version; earlier versions stay readable | M |
| FR-P6 | Three sample programs are provided | M |
| FR-P7 | The editor validates live and shows the generated Prolog facts | S |
| FR-P8 | When writing a letter, the app warns if the policy would never release it and offers to add `release letters to <name> after death;` | S |

### 8.6 Grounded AI Q&A (C6): model, tools and instructions

| ID | Requirement | Pri |
|---|---|---|
| FR-AI1 | **Model:** the language model is replaceable behind one interface; default is a built-in offline model, optional Anthropic or OpenAI-compatible model by configuration | M |
| FR-AI2 | **Tools:** the model can only call `search_entries`, `check_access`, `get_entry`, `entries_about_me` and `my_letters`; it never reads the vault directly | M |
| FR-AI3 | **Instructions:** a fixed system prompt requires: answer only from tool results, cite every statement by entry date, respect access levels, neutral reply when nothing is permitted, speak about the owner and never as the owner | M |
| FR-AI4 | Access is decided by Prolog **before** any content is loaded; only views at the permitted level are given to the tools | M |
| FR-AI5 | If the asker may see nothing, the model is not called and the neutral reply is returned | M |
| FR-AI6 | A leak guard blocks any message that contains text the asker may not see | M |
| FR-AI7 | Only dates of entries actually read at summary or verbatim level are kept as citations | M |
| FR-AI8 | "Did he ever write about me?" returns the number of permitted entries that mention the asker and their dates, never their content | M |
| FR-AI9 | A letter asked for before its release is refused with its opening date; after release it is shown verbatim | M |
| FR-AI10 | A question about something hidden or absent gets the **same** neutral reply, which neither confirms nor denies | M |
| FR-AI11 | The owner can preview answers "as" any beneficiary | S |
| FR-AI12 | Every question is audited: who asked, which entries were authorised, read and cited | M |

### 8.7 Trustee and death trigger

| ID | Requirement | Pri |
|---|---|---|
| FR-T1 | The owner chooses one activated beneficiary as **trustee** | M |
| FR-T2 | The trustee reports the owner's passing with their password and the phrase `REPORT PASSING` | M |
| FR-T3 | The owner is emailed and can cancel ("I'm still here") during a waiting period (`DEATH_REPORT_WAIT_MINUTES`, default 14 days) | M |
| FR-T4 | If not cancelled or withdrawn, the death trigger activates automatically; the owner can also activate it with their password and `SEAL MY VAULT` | M |
| FR-T5 | On activation, each beneficiary with something available is emailed a notice and a sign-in link; **no diary text is ever emailed** | M |

### 8.8 Letters for beneficiaries

| ID | Requirement | Pri |
|---|---|---|
| FR-L1 | A beneficiary sees a Letters page with the letters released to them | M |
| FR-L2 | Every letter screen and the notice email carry the not-a-legal-will disclaimer | M |
| FR-L3 | When a letter opens after the death trigger (its date arrives), its recipient is emailed once: the title and a sign-in link, never the letter's text | M |

## 9. Non-functional requirements

### 9.1 Security

| ID | Requirement |
|---|---|
| NFR-S1 | **Deny by default** at every layer: Prolog decision, API, AI tools |
| NFR-S2 | Passwords hashed with scrypt; verification and reset codes stored as hashes, expire in 15 minutes, 5 attempts, resend limited |
| NFR-S3 | Signed session tokens (JWT) with a version that is bumped on password reset |
| NFR-S4 | Append-only tables enforced by ORM listeners **and** database triggers (SQLite and PostgreSQL) |
| NFR-S5 | If an entry or policy hash chain fails, nothing is released to beneficiaries (`TamperDetected`) |
| NFR-S6 | Secrets (database URL, JWT secret, email API key) are environment settings, never in the repository |

### 9.2 Privacy

| ID | Requirement |
|---|---|
| NFR-P1 | Hidden and missing entries are indistinguishable to askers (`AccessDenied` → same reply as "not found") |
| NFR-P2 | Emails never contain diary content |
| NFR-P3 | Drafts never leave the browser until saved; erased on sign-out |
| NFR-P4 | Only fictional data in code, tests, demo and documents |
| NFR-P5 | The AI provider receives only permitted views; with the default offline model nothing leaves the server |

### 9.3 Honesty of the AI

| ID | Requirement |
|---|---|
| NFR-H1 | The AI speaks **about** the owner and never claims to be the owner |
| NFR-H2 | It quotes only the owner's real words, and cites the date of every entry it uses |
| NFR-H3 | It says so when there is no record, instead of guessing |
| NFR-H4 | It does not hint at hidden entries or mention policies or denials |

### 9.4 Reliability and failure handling

| ID | Requirement |
|---|---|
| NFR-R1 | Typed exceptions with a safe action for each: `AccessDenied` (answer as not found), `AmbiguousName` (share nothing about that name), `TamperDetected` (release nothing), `PolicySyntaxError` (keep the previous policy) |
| NFR-R2 | Prolog or AI failures return a clear "unavailable" message and share nothing |
| NFR-R3 | A failed email never undoes the death trigger; notices are kept and can be retried |
| NFR-R4 | The full test suite passes on SQLite and PostgreSQL before every release |

### 9.5 Usability, accessibility and portability

| ID | Requirement |
|---|---|
| NFR-U1 | Works on desktop and phone widths (responsive layout) |
| NFR-U2 | Plain, everyday wording; clear messages when something cannot be shared |
| NFR-U3 | Real buttons, labels and keyboard focus; text contrast of at least 4.5:1 |
| NFR-U4 | Runs locally with documented setup, and deploys to free hosting |
| NFR-U5 | The first request after the free server sleeps may take up to about a minute (accepted) |

## 10. Typed failures

| Exception | Raised when | Safe action |
|---|---|---|
| `AccessDenied` | An asker requests an entry or letter Prolog does not allow | Reply exactly as for a missing entry |
| `AmbiguousName` | The asker's first name is shared with another beneficiary | Do not guess; share nothing about that name |
| `TamperDetected` | The entry or policy hash chain does not verify | Release nothing to beneficiaries; audit; owner can inspect |
| `PolicySyntaxError` | A policy does not lex, parse or check | Reject it; keep the previous version |

## 11. Assumptions and constraints

**Assumptions**
1. Each diary has one owner, who is an adult and writes in English or Filipino.
2. Beneficiaries have their own email addresses and can sign in from a browser.
3. The trustee is someone the owner trusts to report the passing honestly; the waiting period and the owner's cancel button protect against mistakes.
4. Email can be delivered (an email service is configured); without it, notices are stored for retry.
5. Names in entries are written as names (e.g. "Maria") so that `mentioning` filters work.
6. The team has five members, one per role, and all can explain the whole system.

**Constraints**
1. Paradigms are fixed by the course (section 7).
2. Only fictional data may be stored, in the code, the demo and any public repository.
3. Free hosting limits: the server sleeps when idle; the database has a size limit.
4. Presentation and defense in Weeks 16–17; exact dates set by the instructor.
5. AI coding tools may be used only with an AI-use log and verification by a named member.

## 12. Not-a-legal-will limitation

> **Not a legal will.** Letters and the legacy policy in MMK are personal messages and wishes. They are not a will and have no legal effect on property or inheritance. Philippine law has formal requirements for wills; for those, consult a lawyer. MMK does not give legal advice.

This disclaimer is shown on the Legacy policy page, in the letter composer, on the beneficiary's Letters page and in the death-notice email (FR-L2). The app never calls itself a will, a testament or legal advice.

## 13. Data policy

- All test and demo data is invented. Sample owner: *Juan Santos* (handout scenario) and *Elena Ramos* (demo vault); beneficiaries *Maria Santos*, *Adam Santos Jr*, *Jose Ramos*, *Lina Cruz*.
- Demo account passwords appear in the README and must never be loaded into a live database used by real people.
- No team member stores a real diary, real passwords or real personal details in the project.

## 14. Deliverables

| Deliverable | Location |
|---|---|
| Working prototype, under version control | repository; live at https://mmk-web.onrender.com |
| README with setup steps | `README.md` |
| This proposal and final requirements | `docs/PROPOSAL.md` |
| AI design note (model, tools, instructions) | `docs/AI_DESIGN.md` |
| EBNF grammar and three samples | `backend/app/policy_lang/` |
| Prolog rule file and access test table | `backend/app/prolog/access_rules.pl`, `docs/ACCESS_TEST_TABLE.md` |
| Parser tests | `backend/tests/test_policy_language.py` |
| Design report | `docs/DESIGN_REPORT.md` |
| AI-use log | `docs/AI_USE_LOG.md` |
| Extra features list | `docs/EXTRA_FEATURES.md` |
| Kaneo workspace with weekly updates | [LINK TO KANEO] |
| Slides and live demo | [SLIDES LINK] |

## 15. Traceability: requirement → test

| Requirements | Verified by |
|---|---|
| FR-A1–A5 | `test_email_verification.py`, `test_password_recovery.py`, `test_api_security.py`, `test_invitations_and_letter_emails.py` |
| FR-D1–D7 | `test_processing.py`, `test_hashchain.py`, `test_api_security.py` |
| FR-W1–W4 | `test_writing_modes.py` |
| FR-R1–R10 | `test_prolog_rules.py`, `test_access_table.py` (22 rows), `test_api_security.py` |
| FR-P1–P8 | `test_policy_language.py`, `test_api_security.py::test_letter_release_check_and_add` |
| FR-AI1–AI12 | `test_ai.py`, `test_handout_scenarios.py` |
| FR-T1–T5 | `test_executor.py`, `test_death_notices.py` |
| FR-L1–L3 | `test_death_notices.py`, `test_invitations_and_letter_emails.py`, demo walkthrough |
| NFR-S, NFR-P, NFR-R | `test_typed_exceptions.py`, `test_hashchain.py`, `test_ai.py` (leak guard, adversarial model) |
| NFR-H | `test_ai.py::test_system_prompt_requires_grounding_and_citations`, `test_handout_scenarios.py` |
| NFR-U | Demo walkthrough on desktop and phone (UI/UX Designer) |

## 16. Review and approval

The requirements become the baseline when every member has read this document and signs below. Approval is also recorded on the Kaneo task.

| Member | Role | Reviewed sections | Decision | Date |
|---|---|---|---|---|
| [MEMBER 1 FULL NAME] | Front End | | ☐ Approved ☐ Changes requested | |
| [MEMBER 2 FULL NAME] | Back End | | ☐ Approved ☐ Changes requested | |
| [MEMBER 3 FULL NAME] | Q/A | | ☐ Approved ☐ Changes requested | |
| [MEMBER 4 FULL NAME] | UI/UX Designer | | ☐ Approved ☐ Changes requested | |
| [MEMBER 5 FULL NAME] | Documentator | | ☐ Approved ☐ Changes requested | |

## 17. Change log and future work

| Version | Date | Change | Agreed by |
|---|---|---|---|
| 1.0 | [DATE] | First baseline | [ALL MEMBERS] |

**Future work (not in this baseline):** `transfer custody to <name> if trustee unavailable for <n> days` and `default writing mode: <mode>` as policy statements; a backup trustee; encryption at rest; nicknames and aliases for names; voice and photo entries.

## 18. Glossary

| Term | Meaning |
|---|---|
| Owner | The person who writes the diary |
| Registered asker / beneficiary | A person the owner registered, who may ask about the diary after the owner's passing |
| Trustee (Executor) | The beneficiary chosen to report the owner's passing |
| Death trigger | The event that ends the owner's lifetime protection and puts the policy into effect |
| Legacy policy | The owner's program in the Legacy Policy language |
| Access level | existence, summary or verbatim (full text) |
| Revision | A later version of an entry; the original stays |
| Hash chain | Each record's hash includes the previous record's hash, so any change is detectable |
| Neutral reply | "I'm not able to share anything about that from the diary." |
