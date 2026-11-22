# Design note: the three parts of MMK's AI

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

The handout asks for three separate parts: a **model** that can think, **tools** that let it act, and **instructions** that tell it what to do without us. In MMK they live in three different places in the code, so each can be changed and tested on its own.

```
question ──► Prolog decides access FIRST (access_rules.pl)
               │  only authorised views are built (AuthorizedContext)
               ▼
           Assistant loop  ◄──►  MODEL (providers.py)
               │                    ▲
               │   tool calls       │  INSTRUCTIONS (SYSTEM_PROMPT in assistant.py)
               ▼                    │  + the owner's policy, already applied by Prolog
           TOOLS (tools.py) ────────┘
               │
               ▼
           leak guard + citation check ──► answer with dated citations
```

## 1. The model

| Setting | Provider | Model | When to use |
|---|---|---|---|
| `LLM_PROVIDER=offline` (default) | Built-in extractive agent (`OfflineProvider`) | `alaala-extractive-1` | Demos, tests and free hosting. Deterministic: it only arranges sentences the tools returned. No external service, no API key |
| `LLM_PROVIDER=anthropic` | Anthropic Messages API (`AnthropicProvider`) | `claude-sonnet-5-5` (`LLM_MODEL`) | Natural, fluent answers |
| `LLM_PROVIDER=openai` | Any OpenAI-compatible endpoint (`OpenAIProvider`) | set `LLM_MODEL`, `LLM_BASE_URL` | Other hosted or local models |

All three implement the same interface, `LLMProvider.complete(system, messages, tools)`, so the rest of the system does not know or care which model is used.

**Why the default is an offline model.** It cannot invent anything: every sentence it writes comes from a tool result. That makes the access tests exact and reproducible, and the app works without paying for an API. A hosted model can be switched on with one setting; the same tools, instructions and guards apply.

## 2. The tools

The model never reads the vault. It can only call these five functions (`backend/app/ai/tools.py`), and each one works on `AuthorizedContext`: views of the entries, already cut down to the level Prolog allowed, built **before** the model is called.

| Tool | What it returns | Never returns |
|---|---|---|
| `search_entries(query, from_date?, to_date?)` | Matching entry ids, dates and access levels. Only content the asker may see is searchable | Any content |
| `check_access(entry_id)` | `none`, `existence`, `summary` or `verbatim` | Why |
| `get_entry(entry_id)` | The entry at its permitted level: date only, summary + topics, or full text | Anything above the level; a hidden entry looks exactly like a missing one (`AccessDenied` → "not available") |
| `entries_about_me()` | How many of the asker's permitted entries mention them, and their dates | Content; nothing at all if the asker's name is ambiguous (`AmbiguousName`) |
| `my_letters()` | The asker's own letters: full text when released, otherwise the title and the opening date | Anyone else's letters; the text of an unreleased letter |

## 3. The instructions

**Standing rules** (`SYSTEM_PROMPT` in `backend/app/ai/assistant.py`), sent with every request:

1. Answer only from what the tools return; never guess or use outside knowledge.
2. Search first, then read the entries you rely on.
3. Cite every factual statement with the entry date, like `[2019-05-14]`.
4. Respect access levels: existence = only that it exists; summary = only the summary; verbatim = may quote.
5. If nothing relevant comes back, give the neutral reply and do not hint at hidden entries or mention policies.
6. "Did he write about me?": give only the number of entries and their dates.
7. Letters: quote a released letter in full; for an unreleased one, say so and give its opening date.
8. Speak *about* the owner in the third person; never claim to be the owner or write in their voice.
9. Be warm, brief and respectful; answer in the language of the question.

**The owner's policy** is the other half of the instructions. It is not pasted into the prompt for the model to obey; it is compiled to Prolog and enforced **before** the model sees anything, so a model that ignores its instructions still cannot reach what the policy hides.

## Guards around the model

| Guard | Where | What it does |
|---|---|---|
| Decide first | `qa_service.build_context` | Prolog decisions are made before any content is loaded; views are rendered at the permitted level and the full entries are discarded |
| No model when nothing is allowed | `Assistant.ask` | If the asker may see nothing, the model is never called; the neutral reply is returned |
| Leak guard | `LeakGuard` | Holds SHA-256 fingerprints of every sentence the asker may not see; any outgoing message containing one is stopped and the neutral reply is returned |
| Citation check | `Assistant._finalize` | Keeps only citations to entries whose content was actually retrieved at summary or verbatim level |
| Integrity gate | `services/integrity.py` | If the entry or policy hash chain fails, nothing is released (`TamperDetected`) |
| Audit | `audit_log` | Every question records which entries were authorised, retrieved and cited |

## How it is tested

| Test file | What it proves |
|---|---|
| `tests/test_ai.py` | Tools, citations, existence/summary limits, an adversarial "greedy" model that tries to fetch every id, the leak guard, letters reaching only their recipient |
| `tests/test_handout_scenarios.py` | The handout's Maria table, end to end, including that hidden text never reaches the model |
| `tests/test_typed_exceptions.py` | `AccessDenied`, `TamperDetected` and `PolicySyntaxError` lead to the safe action |
