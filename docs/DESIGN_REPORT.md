# Design report: paradigm choices

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

MMK (Maalaala Mo Kaya) is our build of the Alaala personal AI diary. This report explains which paradigm each required component uses, why it fits, and what we would change.

## The six required components

| Component | Paradigm | Where | Why this paradigm fits |
|---|---|---|---|
| Diary model | Object-oriented | `backend/app/domain/` | The diary is made of things with identity and behaviour: an owner, beneficiaries, entries, a vault, a protocol and its rules. Classes keep each one's data and rules together |
| Entry processing | Functional | `backend/app/processing/pure.py`, `hashchain.py` | Processing text is a pipeline of transformations. Pure functions over immutable data are easy to test, cannot corrupt the stored original, and fit an append-only, hash-chained record |
| Writing modes | Object-oriented (polymorphism) | `backend/app/writing_modes.py` | Three modes answer the same question ("what happens to my words?") differently. One interface with three classes lets the rest of the code call `mode.process(text)` without knowing which mode it is |
| Access rules | Logic (Prolog) | `backend/app/prolog/access_rules.pl` | Access is a set of facts and rules with precedence (deny by default, deny beats allow, release dates, frozen after death). Prolog states these rules directly and answers *why* for every decision |
| Legacy Policy language | Language design | `backend/app/policy_lang/` | Owners describe wishes in a small, readable language. An EBNF grammar, lexer, recursive-descent parser and interpreter turn it into Prolog facts and give precise errors |
| Grounded AI Q&A | Scripting | `backend/app/ai/`, `services/qa_service.py` | Python scripts the conversation: it asks Prolog, builds permitted views, calls the model and its tools, then checks the answer. The glue between model, tools and rules is a script, not a model |

### 1. Diary model (object-oriented)

- **Classes:** `Person` (abstract) → `Owner`, `Beneficiary`; `Entry` (abstract) → `TextEntry`, `LetterEntry`, with `Revision`; `Vault`; `Protocol` holding `Rule` objects → `Group`, `Grant`, `Denial`, `LetterRelease`, with `Filter` and `Condition` hierarchies.
- **Inheritance:** `LetterEntry` adds a recipient and release conditions to `Entry`.
- **Polymorphism:** `entry.render(level)`: a letter is all-or-nothing, a text entry can be shown at existence, summary or verbatim level. Each `Rule` translates itself to Prolog with `to_prolog()`.
- **Encapsulation:** entry fields are private and read-only; the only way to change an entry is to add a revision through the `Vault`, which re-links the hash chain. A sealed vault refuses changes (`VaultSealedError`).

### 2. Entry processing (functional)

`normalize → extract (names, topics) → correct → diff`, plus `apply_diff`/`revert_diff`. Every function is pure: same input, same output, no I/O, no mutation; results are frozen dataclasses. Entries and revisions are append-only (refused by ORM listeners and by database triggers) and each record's hash covers the previous record's hash, so any edit breaks the chain.

### 3. Writing modes (object-oriented)

`WritingMode` (abstract) → `VerbatimMode`, `LightFixMode`, `ReviewMode`, chosen by key at runtime (`get_mode`). In every mode the original is stored untouched; Light Fix saves its corrections as a revision, Review saves suggestions for the owner to accept.

### 4. Access rules (Prolog)

`decision(Beneficiary, Entry, Today, Level, Reason)` checks, in order: registered beneficiary → owner alive (nothing is shared) → explicit deny → the best matching grant whose date has come → otherwise `default_deny`. Letters have their own rule: only to their recipient, only when both the letter's own date and a `release letters` rule allow it. `can_modify_policy` fails after the death trigger. The Python side never decides access; if Prolog is missing or errors, nothing is shared.

### 5. Legacy Policy language

- Grammar: `backend/app/policy_lang/grammar.ebnf`; documentation: `docs/POLICY_LANGUAGE.md`.
- Four statement types: `group`, `allow`, `deny`, `release letters`. Filters: `about`, `mentioning`, `from`, `until`. Conditions: `after <date>`, `after death`.
- Pipeline: lexer (`PolicySyntaxError` with line and column) → recursive-descent parser → interpreter (checks unknown beneficiaries and groups, duplicate or clashing groups, invalid calendar dates, a `from` later than `until`) → `to_prolog`.
- Three sample programs in `policy_lang/samples/`. Parser tests: `tests/test_policy_language.py`.

**The handout's sample policy in our syntax.** The handout says its syntax is a starting point. Its first three lines map directly:

| Handout | MMK |
|---|---|
| `may see existence of entries mentioning maria` | `allow maria existence access to entries mentioning "maria";` |
| `may read summary of entries tagged "family"` | `allow maria summary access to entries about "family";` |
| `release letter "To my daughter" to maria when date >= 2040-05-01` | the letter carries its own date, plus `release letters to maria after 2040-05-01;` |
| `transfer custody to adam_jr if trustee unavailable for 90 days` | not a policy statement in MMK: custody is handled by the executor feature (see "What we would change") |
| `default writing mode: light_fix` | a Settings option, not a policy statement (see "What we would change") |

### 6. Grounded AI Q&A (scripting)

See `docs/AI_DESIGN.md` for the model, the five tools and the instructions. Entries the asker may not see never reach the model: they are filtered by Prolog before the model is called, and a leak guard checks every outgoing message.

## Typed failures

| Exception | Safe action |
|---|---|
| `AccessDenied` | Answer exactly as if the entry did not exist |
| `AmbiguousName` | Do not guess who is meant; share nothing about that name |
| `TamperDetected` | Release nothing to beneficiaries until the chain is fixed; the owner can still inspect it |
| `PolicySyntaxError` | Reject the program; keep the previous policy version |

Defined in `backend/app/errors.py`; tested in `tests/test_typed_exceptions.py` and `tests/test_handout_scenarios.py`.

## What we would change

1. **Custody transfer and default writing mode as policy statements.** The handout's sample has `transfer custody … if trustee unavailable for 90 days` and `default writing mode: light_fix`. We kept the language to the four access statements and put these in Settings and the executor feature. Next, we would add them as statements 5 and 6 so a whole legacy plan fits in one program.
2. **A backup executor.** Today one executor reports the owner's passing. A second, used only if the first does not respond for a set time, would match the handout's "trustee unavailable" idea.
3. **Encryption at rest.** Entries are protected by access rules and hash chains, but stored as plain text in the database. Encrypting each owner's vault would protect it from someone with database access.
4. **Smarter name matching.** `entries mentioning "maria"` matches the extracted first name. Nicknames ("Ria") or two people named Maria need an alias list per beneficiary.

## Answers to the defense questions

**Why Prolog for the access rules instead of `if` statements?** The rules are declarative: "deny beats allow", "nothing before death", "a letter only to its recipient". In Prolog each is one clause, the order of precedence is visible, and every decision returns a reason we can show the owner (Access permissions page). With `if` statements the precedence would be buried in control flow and easy to break.

**Why are entries immutable and hash-chained?** A diary that speaks for someone after they die must be trustworthy. Immutability means the original words are never lost (corrections are revisions). The hash chain makes any change outside the app detectable, and when it is detected the system stops releasing content (`TamperDetected`).

**What happens when two rules conflict?** An explicit `deny` always wins over any `allow`. Between allows, the highest permitted level whose condition has been met applies. Anything no rule allows is denied. The rule and line number that decided are shown for every entry.

**How do you stop the AI from seeing an entry the asker may not read?** It is never given one. Prolog decides first; only views at the permitted level are built; the model can only call tools over those views; the model is not called at all when nothing is permitted; and the leak guard blocks any message containing a fingerprint of hidden text. `tests/test_ai.py` includes an adversarial model that tries to fetch every entry id.

**Which part of your code did AI write, and how did you check it?** See `docs/AI_USE_LOG.md`.

**If you added a feature, which paradigm does it use and why?** See `docs/EXTRA_FEATURES.md`.
