# MMK Legacy Policy Language (ALP)

> **Team:** [MEMBER 1 FULL NAME] (Front End) · [MEMBER 2 FULL NAME] (Back End) · [MEMBER 3 FULL NAME] (Q/A) · [MEMBER 4 FULL NAME] (UI/UX Designer) · [MEMBER 5 FULL NAME] (Documentator)

A policy is a list of statements, each ending with `;`. Comments start with `#`.
**Anything not allowed is denied, and `deny` always overrides `allow`.**
**Nothing is shared while the owner is alive:** the whole policy takes effect only after the death trigger. `after death` is therefore optional (it is implied); `after DATE` means "after the owner's passing, and not before DATE".

## Grammar (EBNF)
The full grammar is in `backend/app/policy_lang/grammar.ebnf`:

```ebnf
program        = { statement } , EOF ;
statement      = group_stmt | allow_stmt | deny_stmt | release_stmt ;
group_stmt     = "group" , IDENT , "=" , IDENT , { "," , IDENT } , ";" ;
allow_stmt     = "allow" , subject , level , "access" , "to" , scope , [ condition ] , ";" ;
deny_stmt      = "deny" , subject , "access" , "to" , scope , ";" ;
release_stmt   = "release" , "letters" , "to" , subject , condition , ";" ;
subject        = IDENT | "everyone" ;
level          = "existence" | "summary" | "verbatim" ;
scope          = "entries" , { filter } ;
filter         = "about" , STRING | "mentioning" , STRING | "from" , DATE | "until" , DATE ;
condition      = "after" , ( DATE | "death" ) ;
```

## The four statement types
| Statement | Example | Prolog fact produced |
|---|---|---|
| group | `group kids = maria, jose;` | `group_member('kids','maria').` … |
| allow | `allow kids summary access to entries about "family" after 2030-01-01;` | `rule_grant(2,'kids',summary,[topic('family')],date(20300101)).` |
| deny | `deny jose access to entries about "health";` | `rule_deny(3,'jose',[topic('health')]).` |
| release | `release letters to maria after death;` | `rule_letters(4,'maria',death).` |

Filters within one statement are combined with AND. A letter is released only when its own release date or after-death flag is satisfied **and** a `release` statement for the recipient is satisfied.

## Pipeline
1. **Lexer** (`lexer.py`) produces tokens with line and column. It reports unterminated strings, malformed dates, uppercase identifiers and stray characters.
2. **Recursive-descent parser** (`parser.py`) has one method per grammar rule and builds an immutable AST (`ast.py`). On an error it skips to the next `;` and continues, so all syntax errors are reported in one pass.
3. **Interpreter** (`interpreter.py`) walks the AST and checks meaning:
   - subjects must be known beneficiaries, groups defined *earlier*, or `everyone`
   - group names must be unique and must not clash with a beneficiary
   - dates must be real calendar dates, `from` must not be later than `until`, and each of `from`/`until` may appear once per statement

   It warns about unknown topics and about allows that a blanket deny cancels. Its output is a domain `Protocol`.
4. **Translation** (`to_prolog.py`): each rule's `to_prolog()` emits facts, and atoms are safely quoted. Rules are also stored as structured JSON with every saved version.

## Samples (`backend/app/policy_lang/samples/`)
- `01_family_basics.alp`: groups, summary for the family, verbatim on one topic, letters after death
- `02_privacy_and_dates.alp`: an explicit deny overriding a broad allow, existence-only access, date-based release
- `03_after_death.alp`: nothing shared during life, everything after death except money for some people, letters by date

## Topics understood by `about "…"`
family, work, health, travel, love, faith, money, school, food, friendship, home, grief. Any `#hashtag` written in an entry also becomes a topic.
