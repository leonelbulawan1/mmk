<img src="docs/brand/mmk-mark.svg" width="72" alt="MMK logo">

# MMK — a personal AI diary with a legacy policy

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

**MMK** is a private diary. An **owner** writes entries that are stored append-only and linked in a hash chain. The owner registers **beneficiaries** and writes a **legacy policy** in a small language. **Beneficiaries get no access at all while the owner is alive.** After the owner's passing (the death trigger, started by the owner or by their chosen executor), the policy decides who may learn what, at what level (existence, summary or full text), and when (immediately, or on a later date). Beneficiaries ask questions through an **AI assistant** that only ever receives entries the SWI-Prolog access rules have already approved, and it cites the date of every entry it uses.

## Team

| # | Complete name | Role |
|---|---|---|
| 1 | Leonel C. Bulawan | Project Manager |
| 2 | Gabriel E. Liray | Lead Developer |
| 3 | Kean Jayvee B. Gito | QA/Tester |
| 4 | Robylyn U. Flores | UI/UX Designer |

Repository: https://github.com/leonelbulawan1/mmk · Kaneo project: [KANEO PROJECT LINK]

## Repository layout

```
mmk/
├── backend/                  source code: API (Python, FastAPI)
│   ├── app/                  application code
│   │   ├── prolog/           Prolog rules (access_rules.pl) and the Python bridge
│   │   ├── policy_lang/      grammar (grammar.ebnf), lexer, parser, interpreter, sample policies
│   │   ├── ai/               AI assistant: tools, providers, leak guard
│   │   ├── routers/          REST endpoints
│   │   └── services/         vault, policy, email, death verification
│   └── tests/                automated tests (pytest)
├── frontend/                 source code: website (React, Vite, Tailwind)
│   └── src/
├── docs/                     documentation: proposal, UML, design, security, testing
├── reports/                  weekly updates and links to project reports
├── .github/                  pull request template
├── render.yaml, DEPLOY.md    deployment
└── README.md
```

| Required folder | Location |
|---|---|
| Source code | `backend/app/`, `frontend/src/` |
| Prolog rules | `backend/app/prolog/` |
| Grammar | `backend/app/policy_lang/` (`grammar.ebnf`) |
| Tests | `backend/tests/` |
| Docs | `docs/` |
| Reports | `reports/` |

The Prolog rules and the grammar stay inside `backend/app/` because the server loads them from there at run time (`/api/policy/grammar` serves the EBNF file) and the Docker image is built from `backend/`.

## Branching and commit convention

**Branches.** `main` is always deployable: Render deploys every push to it. Nobody commits to `main` directly.

1. Update: `git switch main && git pull`
2. Branch: `git switch -c <type>/<short-description>`, lowercase with hyphens, for example `feat/letter-schedule`, `fix/login-limit`, `docs/uml-sequence`, `test/prolog-deny-rules`.
3. Commit small steps (convention below) and push: `git push -u origin <branch>`.
4. Open a pull request into `main` using the template; link the Kaneo card.
5. One other member reviews. Merge only when the tests and the build pass. Use **Squash and merge** so `main` gets one commit per change, then delete the branch.

**Commit messages** ([Conventional Commits](https://www.conventionalcommits.org/)):

```
type(scope): short summary in the imperative

Why the change was needed and what it does.

Refs: KANEO-<card number>
```

| Type | Use for |
|---|---|
| `feat` | a new feature |
| `fix` | a bug fix |
| `docs` | documentation and reports only |
| `test` | adding or fixing tests |
| `refactor` | code change that does not change behaviour |
| `style` | formatting only |
| `chore` | build, dependencies, configuration |

Scopes: `frontend`, `backend`, `prolog`, `grammar`, `ai`, `db`, `docs`, `reports`, `deploy`.
Examples: `feat(prolog): deny rules override allow rules`, `fix(frontend): keep cursor after auto-correct`, `docs(reports): week 3 update`.
Run `git config commit.template .gitmessage` once to get this format in your editor.

**Never commit** `.env` files, passwords, API keys, database URLs or real personal data. All people in examples and tests are fictional.

## 1. Quick start

### Prerequisites
- Python 3.11 or newer
- Node.js 20 or newer
- SWI-Prolog 9 or newer, with `swipl` on your PATH
  - Ubuntu/Debian: `sudo apt-get install swi-prolog-nox`
  - macOS: `brew install swi-prolog`
  - Windows: install from swi-prolog.org and add `swipl.exe` to PATH, or set `SWIPL_PATH`

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # then set JWT_SECRET
python -m app.seed --reset                            # optional fictional demo data
uvicorn app.main:app --reload --port 8000
```
Interactive API docs: http://127.0.0.1:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev            # http://localhost:5173  (/api is proxied to :8000)
```
Production build: `npm run build`. This writes static files to `frontend/dist`. Serve them behind the same origin as the API, or set `VITE_API_BASE` at build time.

### Demo accounts (after `python -m app.seed`)
| Role | Email | Password |
|---|---|---|
| Owner | elena@example.com | alaala2026 |
| Beneficiary (daughter) | maria@example.com | alaala2026 |
| Beneficiary (son) | jose@example.com | alaala2026 |
| Beneficiary (friend) | lina@example.com | alaala2026 |

To try **Sign in → Forgot password?**, use any demo account: a 6-digit code is emailed (shown on screen in the demo or when `DEV_SHOW_VERIFICATION_CODE=true`).

New beneficiaries are added by an owner on **Beneficiaries**. That page shows a single-use invite code and a one-click activation link once. The beneficiary opens the link (or uses **I received an invitation** on the home page) and chooses a password.

### Tests
```bash
cd backend && python -m pytest          # 195 tests
```

### Browser edition (no server needed)
```bash
cd frontend && bash scripts/build-web.sh      # output: frontend/dist-web/ (~25 MB static site)
```
This builds a static site that runs the **whole system in the browser**:
- the real Python backend (FastAPI app, domain model, policy compiler, AI tools) runs on **Pyodide** (CPython compiled to WebAssembly)
- the real `access_rules.pl` runs on **SWI-Prolog compiled to WebAssembly** (`swipl-wasm`)
- SQLite runs in memory and is saved to the visitor's IndexedDB after each request

Each visitor gets their own private copy, seeded with the fictional demo vault. It can be hosted on any static host (Firebase Hosting, GitHub Pages, a claude.ai artifact). Limits: only the built-in offline AI model is available, data stays in that one browser, and email notices cannot be sent (they are kept in the outbox so you can read them). The bridge lives in `backend/app/webrun.py` and `frontend/src/webRuntime.js`. Static hosts that refuse `.whl`, `.zip` or `.pl` files are handled by giving those files a `.wasm` or `.txt` suffix, which `webRuntime.js` maps back.

---

## 2. Configuration (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///backend/alaala.db` | Any SQLAlchemy URL |
| `JWT_SECRET` | random per process | **Set this.** Tokens are invalidated whenever it changes |
| `JWT_TTL_MINUTES` | 480 | Lifetime of a session token |
| `CORS_ORIGINS` | localhost:5173 | Comma-separated list of allowed origins |
| `SWIPL_PATH` | `swipl` | Path to the Prolog executable |
| `APP_TIMEZONE` | `UTC` | Timezone used for "today" in date-based release (e.g. `Asia/Manila`) |
| `LLM_PROVIDER` | `offline` | `offline`, `anthropic` or `openai` |
| `LLM_MODEL` | `claude-sonnet-5-5` | Model name for the provider |
| `LLM_API_KEY` | – | API key (required for `anthropic` and `openai`) |
| `LLM_BASE_URL` | provider default | Custom endpoint, e.g. a self-hosted OpenAI-compatible server |
| `APP_URL` | `http://localhost:5173` | Public address of the app, used in email links |
| `DEV_SHOW_VERIFICATION_CODE` | `false` | Development only: when email cannot be sent, show the sign-up verification code on screen. Never enable on a public server |
| `DEATH_REPORT_WAIT_MINUTES` | `20160` (14 days) | How long an executor's report of the owner's passing waits for an “I'm still here” before the death trigger activates |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | empty / 587 / – / – / – / true | Mail server for the automatic death-trigger notices. If `SMTP_HOST` is empty, notices wait in the outbox on the Settings page and can be retried later |

The `offline` provider is a deterministic agent with no network access. It goes through the same tool-calling loop (search → get_entry → answer with citations), so the app and its tests run without an API key. It answers by quoting and summarising authorised text, not by generating prose. Set `LLM_PROVIDER=anthropic` (or `openai`) to use a real language model.

---

## 3. Deploying

**Free (recommended for testing): [DEPLOY.md](DEPLOY.md).** Render runs the API and the website (`render.yaml`), Neon is the PostgreSQL database, and Brevo sends email. Nothing expires and nothing is charged. The free API sleeps when idle, so the first visit after a quiet period takes about a minute.

**Firebase + Cloud Run (paid after a 3-month database trial): [docs/deploy/CLOUD_RUN.md](docs/deploy/CLOUD_RUN.md).** Firebase Hosting, Cloud Run (built from `backend/Dockerfile`) and Cloud SQL for PostgreSQL through Firebase SQL Connect.

The whole test suite also runs against PostgreSQL:

```bash
TEST_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@127.0.0.1:5432/DBNAME pytest -q
```

---

## 4. Repository layout
```
alaala/
├── backend/
│   ├── app/
│   │   ├── domain/            OOP model: Owner, Beneficiary, Entry, TextEntry, LetterEntry, Vault, Protocol, Grant…
│   │   ├── processing/        pure functions: normalize, extract, correct, diff, summarize; hash chain
│   │   ├── writing_modes.py   Verbatim / LightFix / Review (polymorphic strategies)
│   │   ├── prolog/            access_rules.pl + Python bridge (engine.py)
│   │   ├── policy_lang/       grammar.ebnf, lexer, recursive-descent parser, AST, interpreter, to_prolog, samples/
│   │   ├── ai/                tools, providers (Anthropic/OpenAI/offline), assistant loop, leak guard
│   │   ├── services/          persistence <-> domain mapping, policy versions, Q&A orchestration, audit log
│   │   ├── routers/           REST endpoints
│   │   ├── models.py, db.py   SQLAlchemy models, append-only triggers
│   │   ├── security*.py       scrypt hashing, JWT, role dependencies
│   │   └── seed.py            fictional demo data
│   └── tests/                 pytest suite
├── frontend/src/
│   ├── pages/                 the 14 required pages + beneficiary Home and Letters
│   ├── components/            layout, UI kit, diff view
│   └── api.js, auth.jsx
└── docs/                      architecture, policy language, security, testing, screenshots
```

## 5. Pages
| # | Page | Route | Role |
|---|---|---|---|
| 1 | (no landing page) `/` redirects to Sign in, or to the signed-in user's home | `/` | public |
| 2 | Registration (owner sign-up and beneficiary invite activation) | `/register` | public |
| 3 | Login | `/login` | public |
| 4 | Owner dashboard | `/dashboard` | owner |
| 5 | Diary entries (search, kind and theme filters, grouped by year) | `/entries` | owner |
| 6 | Write (diary entries and letters, with writing-mode selection and live preview) | `/write` | owner |
| 7 | Entry details (current/original/revisions, review, hashes) | `/entries/:id` | owner |
| 8 | Writing mode selection with live preview: part of the Write page | `/write` | owner |
| 9 | Beneficiary management (invites, deactivation) | `/beneficiaries` | owner |
| 10 | Legacy policy editor (live validation, Prolog view, samples, history) | `/policy` | owner |
| 11 | Access permissions (Prolog decision matrix, date simulation) | `/access` | owner |
| 12 | AI assistant (beneficiary; owner "preview as") | `/assistant` | both |
| 13 | Vault integrity (three chains, audit log, export) | `/vault` | owner |
| 14 | Settings (profile, password, death trigger) | `/settings` | both |
| – | Beneficiary home, Letters | `/home`, `/letters` | beneficiary |

See `docs/` for the architecture, the policy language reference, the security model and the test catalogue.
