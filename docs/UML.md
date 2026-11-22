# UML Diagrams (Task 1.05)

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

Three UML diagrams of MMK, drawn from the final requirements in [PROPOSAL.md](PROPOSAL.md) (version 1.0) and checked against the code in `backend/app/`. GitHub renders the Mermaid blocks below as diagrams. The same diagrams, with a fully drawn Use Case Diagram, are in the shared doc: [MMK – UML Diagrams (Task 1.05)](https://claude.ai/artifact/Fc8rMdQQSPN3hfUrKzfWQU).

## 1. Use Case Diagram

Mermaid has no use case diagram type, so this is the same diagram written as a graph: stick-figure actors are shown as named nodes, use cases as rounded ovals inside the **MMK system** boundary, dashed arrows are `<<include>>` / `<<extend>>`, and the hollow arrow is generalization (a Trustee is a Beneficiary).

```mermaid
flowchart LR
    Owner([Owner])
    Ben([Beneficiary])
    Trustee([Trustee])
    AI[[AI model]]
    Mail[[Email service]]
    subgraph MMK [MMK system]
        UC0((Sign in))
        UC1((Register and verify email))
        UC2((Write diary entry))
        UC3((Review suggested fixes))
        UC4((Write letter))
        UC5((Manage beneficiaries))
        UC6((Write legacy policy))
        UC7((See who can read an entry))
        UC8((Choose trustee))
        UC9((Verify vault))
        UC10((Cancel death report))
        UC11((Activate death trigger))
        UC12((Activate account))
        UC13((Read released letters))
        UC14((Report owner's passing))
        UC15((Ask about the diary))
        UC16((Check access - Prolog))
        UC17((Notify beneficiaries))
    end
    Owner --- UC0 & UC1 & UC2 & UC3 & UC4 & UC5 & UC6 & UC7 & UC8 & UC9 & UC10 & UC11
    Ben --- UC0 & UC12 & UC13 & UC15
    Trustee --- UC14
    Trustee -- generalization --> Ben
    UC3 -. "<<extend>>" .-> UC2
    UC15 -. "<<include>>" .-> UC16
    UC11 -. "<<include>>" .-> UC17
    UC15 --- AI
    UC17 --- Mail
```

## 2. Sequence Diagrams

### 2.1 Owner saves a diary entry (FR-D1–D6, FR-W1–W4)

```mermaid
sequenceDiagram
    actor Owner
    participant UI as Web UI (Write page)
    participant API as FastAPI /api/entries
    participant VS as vault_service
    participant WM as WritingMode
    participant FP as pure pipeline
    participant V as Vault
    participant DB as Database (append-only)
    Owner->>UI: Type entry, choose mode, press Save
    UI->>API: POST /api/entries {title, text, date, mode}
    API->>API: Validate (text not empty, date not in future)
    API->>VS: create_entry(owner, ...)
    VS->>WM: get_mode(mode).process(text)
    WM->>FP: normalize(text), correct(text), diff(a, b)
    FP-->>WM: Correction, DiffOps
    WM-->>VS: ModeResult (revision text or suggestions)
    VS->>FP: extract(text)
    FP-->>VS: Extraction (names, topics)
    VS->>V: append_entry(TextEntry)
    V-->>VS: entry sealed with prev_hash and hash
    alt mode is Light Fix and something changed
        VS->>V: append_revision(entry_id, fixed text)
    end
    VS->>DB: INSERT entry (and revision)
    DB-->>VS: ok (UPDATE and DELETE are refused by triggers)
    VS-->>API: entry, ModeResult
    API-->>UI: 201 Created
    UI-->>Owner: Entry page: "Saved."
```

### 2.2 Owner saves the legacy policy (FR-P1–P5, FR-R7)

```mermaid
sequenceDiagram
    actor Owner
    participant UI as Web UI (Legacy policy)
    participant API as FastAPI /api/policy
    participant PS as policy_service
    participant LX as Lexer
    participant PR as Parser
    participant IN as Interpreter
    participant PL as Prolog (AccessEngine)
    participant DB as Database
    Owner->>UI: Edit policy text, press Save
    UI->>API: PUT /api/policy {source}
    API->>PS: save_policy(owner, source)
    PS->>PL: can_modify_policy()
    alt death trigger already activated
        PL-->>PS: false
        PS-->>API: PolicyFrozenError
        API-->>UI: 403 Policy is frozen
    else owner is alive
        PL-->>PS: true
        PS->>LX: tokenize(source)
        LX-->>PS: tokens
        PS->>PR: program()
        PR-->>PS: Program (AST)
        PS->>IN: run(program)
        IN-->>PS: Rules (Group, Grant, Denial, LetterRelease) or errors
        alt syntax or semantic errors
            PS-->>API: CompileResult with errors
            API-->>UI: 422 errors with line and column (previous version kept)
        else valid
            PS->>PS: rules to Prolog facts, link_hash(prev, payload)
            PS->>DB: INSERT PolicyVersion v+1
            PS-->>API: version, hash
            API-->>UI: 200 Saved as v+1
        end
    end
```

### 2.3 Beneficiary asks a question (FR-AI1–AI12, FR-R1–R9)

```mermaid
sequenceDiagram
    actor B as Beneficiary
    participant UI as Web UI (Ask)
    participant API as FastAPI /api/assistant/ask
    participant QA as qa_service
    participant IG as Integrity gate
    participant PL as Prolog (AccessEngine)
    participant CTX as AuthorizedContext (tools)
    participant AS as Assistant
    participant LLM as AI model
    participant LG as LeakGuard
    B->>UI: Type a question
    UI->>API: POST {question}
    API->>QA: ask(owner, asker, handle, question, today)
    QA->>PL: decide_all(handle, today)
    PL-->>QA: Decision per entry (level, reason)
    QA->>IG: ensure_intact(vault, policy)
    alt a hash chain is broken
        IG-->>API: TamperDetected
        API-->>UI: 503 nothing can be shared
    else chains verify
        QA->>CTX: build(entries, decisions) - views at permitted level only
        QA->>AS: ask(question)
        alt asker may see nothing
            AS-->>QA: neutral reply (model not called)
        else something is permitted
            loop up to 6 tool rounds
                AS->>LG: check(outgoing messages)
                AS->>LLM: system prompt + messages + tool specs
                LLM-->>AS: tool calls (search_entries, get_entry, ...)
                AS->>CTX: call(tool, args)
                CTX-->>AS: permitted view or "not available" (AccessDenied)
            end
            LLM-->>AS: answer text with [YYYY-MM-DD] dates
            AS->>LG: check(answer)
            AS->>AS: keep only citations of entries actually read
            AS-->>QA: Answer (text, citations)
        end
        QA->>QA: audit: authorised, retrieved, cited
        QA-->>API: Answer
        API-->>UI: answer + dated citations
    end
    UI-->>B: Answer shown with citation chips
```

### 2.4 Trustee reports the owner's passing (FR-T1–T5)

```mermaid
sequenceDiagram
    actor T as Trustee
    actor O as Owner
    participant API as FastAPI
    participant D as death service
    participant N as notify service
    participant PL as Prolog (AccessEngine)
    participant E as Email service
    T->>API: POST /api/executor/report {password, "REPORT PASSING"}
    API->>D: report(owner, trustee)
    D->>N: notify_owner_of_report(owner)
    N->>E: send email to owner
    D-->>API: report pending (waits DEATH_REPORT_WAIT_MINUTES)
    alt owner cancels in time
        O->>API: POST /api/settings/death-report/cancel
        API->>D: cancel_by_owner()
        D-->>O: report cancelled, nothing changes
    else waiting period ends
        D->>D: process_due() (scheduler, sign-in or any request)
        D->>D: activate(owner): death_triggered_at = now
        Note over D: Vault sealed, policy frozen
        D->>PL: decide_all(each beneficiary, after death)
        PL-->>D: decisions
        D->>N: notify_beneficiaries_after_death()
        loop each beneficiary with something available
            N->>E: notice with counts and sign-in link (no diary text)
        end
    end
```

## 3. Class Diagram

`-` private (read through a property), `+` public, `*` abstract method, `$` class method.

### 3.1 Diary model (C1)

```mermaid
classDiagram
    direction TB
    class Person {
        <<abstract>>
        -id: int
        -email: str
        -display_name: str
        -password_hash: str
        +verify_password(password) bool
        +role()* str
        +permissions()* frozenset
    }
    class Owner {
        -death_triggered_at: datetime
        +is_deceased() bool
        +activate_death_trigger(when) datetime
    }
    class Beneficiary {
        -owner_id: int
        -handle: str
        -relationship: str
        -active: bool
    }
    class Vault {
        -owner_id: int
        -entries: tuple~Entry~
        -sealed: bool
        +get(entry_id) Entry
        +append_entry(entry) Entry
        +append_revision(entry_id, text, source) Revision
        +seal() void
        +head() str
        +verify() ChainReport
    }
    class Entry {
        <<abstract>>
        -id: int
        -seq: int
        -title: str
        -original_text: str
        -entry_date: date
        -writing_mode: str
        -extraction: Extraction
        -summary: str
        -prev_hash: str
        -hash: str
        +current_text() str
        +with_revision(revision) Entry
        +sealed(prev_hash, hash) Entry
        +kind()* str
        +hash_payload() dict
        +render(level) dict
    }
    class TextEntry {
        +kind() str
    }
    class LetterEntry {
        -recipient_handle: str
        -release_on: date
        -release_on_death: bool
        +kind() str
        +render(level) dict
    }
    class Revision {
        +id: int
        +seq: int
        +text: str
        +source: str
        +prev_hash: str
        +hash: str
        +hash_payload(entry_seq) dict
    }
    class Protocol {
        -owner_id: int
        -rules: tuple~Rule~
        -source: str
        -version: int
        -frozen: bool
        +grants() tuple~Grant~
        +denials() tuple~Denial~
        +freeze() void
        +replace(rules, source) Protocol
    }
    class Rule {
        <<abstract>>
        +line: int
        +to_prolog(rule_id)* list~str~
        +describe()* str
    }
    class Group {
        +name: str
        +members: tuple~str~
    }
    class Grant {
        +who: str
        +level: str
    }
    class Denial {
        +who: str
    }
    class LetterRelease {
        +who: str
    }
    class Filter {
        <<abstract>>
        +to_prolog()* str
        +describe()* str
    }
    class TopicFilter
    class MentionFilter
    class FromFilter
    class UntilFilter
    class Condition {
        <<abstract>>
        +to_prolog()* str
        +describe()* str
    }
    class Always
    class AfterDate {
        +when: date
    }
    class AfterDeath

    Person <|-- Owner
    Person <|-- Beneficiary
    Owner "1" --> "0..*" Beneficiary : registers
    Owner "1" --> "0..1" Beneficiary : trustee
    Owner "1" --> "1" Vault : owns
    Owner "1" --> "1" Protocol : writes
    Vault "1" *-- "0..*" Entry : contains
    Entry "1" *-- "0..*" Revision : revisions
    Entry <|-- TextEntry
    Entry <|-- LetterEntry
    LetterEntry "0..*" --> "1" Beneficiary : addressed to
    Protocol "1" *-- "0..*" Rule : rules
    Rule <|-- Group
    Rule <|-- Grant
    Rule <|-- Denial
    Rule <|-- LetterRelease
    Grant "1" o-- "0..*" Filter : filters
    Denial "1" o-- "0..*" Filter : filters
    Grant "1" --> "1" Condition : starts
    LetterRelease "1" --> "1" Condition : starts
    Filter <|-- TopicFilter
    Filter <|-- MentionFilter
    Filter <|-- FromFilter
    Filter <|-- UntilFilter
    Condition <|-- Always
    Condition <|-- AfterDate
    Condition <|-- AfterDeath
```

### 3.2 Writing modes, policy language and access rules (C2–C5)

```mermaid
classDiagram
    direction LR
    class WritingMode {
        <<abstract>>
        +key: str
        +label: str
        +description: str
        +process(original)* ModeResult
        +describe() dict
    }
    class VerbatimMode {
        +process(original) ModeResult
    }
    class LightFixMode {
        +process(original) ModeResult
    }
    class ReviewMode {
        +process(original) ModeResult
    }
    class ModeResult {
        +mode: str
        +original: str
        +revision_text: str
        +suggestions: tuple~DiffOp~
        +changes: tuple~Change~
    }
    class pure {
        <<module>>
        +normalize(text) str
        +extract(text, known_names) Extraction
        +correct(text) Correction
        +diff(before, after) tuple~DiffOp~
    }
    class Parser {
        +program() Program
        +statement() Stmt
        +scope() tuple~FilterNode~
        +condition() ConditionNode
    }
    class Interpreter {
        -beneficiaries: set~str~
        +errors: list~PolicySyntaxError~
        +run(program) tuple~Rule~
        +visit(stmt) Rule
    }
    class CompileResult {
        +ok: bool
        +protocol: Protocol
        +errors: list
        +prolog: list~str~
    }
    class AccessEngine {
        +facts() tuple~str~
        +decide_all(handle, today) dict~int, Decision~
        +matrix(today) dict
        +can_modify_policy() bool
    }
    class Decision {
        +entry_id: int
        +level: str
        +reason: str
    }
    WritingMode <|-- VerbatimMode
    WritingMode <|-- LightFixMode
    WritingMode <|-- ReviewMode
    WritingMode ..> ModeResult : creates
    LightFixMode ..> pure : uses
    ReviewMode ..> pure : uses
    Parser ..> Interpreter : AST to
    Interpreter ..> CompileResult : produces
    AccessEngine ..> Decision : returns
    AccessEngine --> Protocol : reads rules
    AccessEngine --> Entry : reads facts
```

### 3.3 AI layer and typed exceptions (C6)

```mermaid
classDiagram
    direction LR
    class Assistant {
        -provider: LLMProvider
        -ctx: AuthorizedContext
        -guard: LeakGuard
        -max_rounds: int
        +ask(question) Answer
    }
    class LLMProvider {
        <<abstract>>
        +model: str
        +complete(system, messages, tools)* LLMResponse
    }
    class OfflineProvider
    class AnthropicProvider
    class OpenAIProvider
    class AuthorizedContext {
        +handle: str
        +views: dict~int, dict~
        +about_me: list
        +letters: list
        +retrieved: dict
        +build(handle, entries, decisions, names, letters)$ AuthorizedContext
        +search_entries(query, from_date, to_date) dict
        +check_access(entry_id) dict
        +get_entry(entry_id) dict
        +entries_about_me() dict
        +my_letters() dict
        +call(name, args) dict
    }
    class LeakGuard {
        +forbidden: frozenset~str~
        +check(text) void
    }
    class Answer {
        +answer: str
        +citations: list
        +blocked: bool
    }
    class AlaalaError {
        <<exception>>
    }
    class AccessDenied {
        <<exception>>
    }
    class AmbiguousName {
        <<exception>>
        +name: str
        +matches: list~str~
    }
    class TamperDetected {
        <<exception>>
        +chain: str
        +position: int
    }
    class PolicySyntaxError {
        <<exception>>
        +line: int
        +col: int
    }
    Assistant "1" --> "1" LLMProvider : model
    Assistant "1" --> "1" AuthorizedContext : tools
    Assistant "1" --> "1" LeakGuard : checks
    Assistant ..> Answer : returns
    LLMProvider <|-- OfflineProvider
    LLMProvider <|-- AnthropicProvider
    LLMProvider <|-- OpenAIProvider
    AuthorizedContext ..> Decision : built from
    AuthorizedContext ..> AccessDenied : raises
    AlaalaError <|-- AccessDenied
    AlaalaError <|-- AmbiguousName
    AlaalaError <|-- TamperDetected
```
