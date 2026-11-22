# Access test table

> **Team:** Leonel C. Bulawan (Project Manager) · Gabriel E. Liray (Lead Developer) · Kean Jayvee B. Gito (QA/Tester) · Robylyn U. Flores (UI/UX Designer)

Each row is one question to the access rules: **may this asker see this entry, and at what level?** The table is computed by the real Prolog rules (`backend/app/prolog/access_rules.pl`), and every row is also an automated test (`backend/tests/test_access_table.py`), so the document and the system cannot drift apart.

Regenerate it with:

```bash
cd backend && python -m scripts.access_table
```

The sample follows the handout: owner **Juan**, beneficiary **Maria**, and **adam_jr**, a registered person with no protocol. It covers every rule the handout names: deny by default, deny beats allow, release dates, nothing while the owner is alive, and letters only to their recipient. (The frozen policy after the death trigger is tested separately in `test_prolog_rules.py` and `test_handout_scenarios.py`.)

Policy used:

```
allow maria existence access to entries mentioning "maria";
allow maria summary access to entries about "family";
deny maria access to entries about "money";
release letters to maria after 2040-05-01;
```

| # | Asker | Entry | When | Expected result | Why |
|---|---|---|---|---|---|
| 1 | maria | Bike (mentions Maria) (2010-06-01) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 2 | maria | Beach (family) (2015-04-02) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 3 | maria | Loan talk (family + money) (2017-02-11) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 4 | maria | Client (business) (2019-08-14) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 5 | maria | Letter: To my daughter (2025-01-01) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 6 | adam_jr | Bike (mentions Maria) (2010-06-01) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 7 | adam_jr | Beach (family) (2015-04-02) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 8 | adam_jr | Loan talk (family + money) (2017-02-11) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 9 | adam_jr | Client (business) (2019-08-14) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 10 | adam_jr | Letter: To my daughter (2025-01-01) | before the death trigger | **nothing** | owner is alive: nothing is shared |
| 11 | maria | Bike (mentions Maria) (2010-06-01) | after the trigger | **existence only** | allowed by a rule |
| 12 | maria | Beach (family) (2015-04-02) | after the trigger | **summary** | allowed by a rule |
| 13 | maria | Loan talk (family + money) (2017-02-11) | after the trigger | **nothing** | explicit deny wins |
| 14 | maria | Client (business) (2019-08-14) | after the trigger | **nothing** | deny by default (no rule allows it) |
| 15 | maria | Letter: To my daughter (2025-01-01) | after the trigger | **nothing** | letter's own date not reached |
| 16 | adam_jr | Bike (mentions Maria) (2010-06-01) | after the trigger | **nothing** | deny by default (no rule allows it) |
| 17 | adam_jr | Beach (family) (2015-04-02) | after the trigger | **nothing** | deny by default (no rule allows it) |
| 18 | adam_jr | Loan talk (family + money) (2017-02-11) | after the trigger | **nothing** | deny by default (no rule allows it) |
| 19 | adam_jr | Client (business) (2019-08-14) | after the trigger | **nothing** | deny by default (no rule allows it) |
| 20 | adam_jr | Letter: To my daughter (2025-01-01) | after the trigger | **nothing** | letter is addressed to someone else |
| 21 | maria | Letter: To my daughter (2025-01-01) | after the trigger, on/after 2040-05-01 | **full text** | letter released |
| 22 | adam_jr | Letter: To my daughter (2025-01-01) | after the trigger, on/after 2040-05-01 | **nothing** | letter is addressed to someone else |

## What each rule is shown by

| Rule from the handout | Rows |
|---|---|
| Nothing is shared while the owner is alive | 1–10 |
| Existence access (entries mentioning Maria) | 11 |
| Summary access (entries tagged family) | 12 |
| Deny beats allow (family **and** money: summary allowed, money denied) | 13 |
| Deny by default | 14, 16–19 |
| Release date not reached | 15 |
| Release date reached: full text | 21 |
| Letters only to their recipient | 20, 22 |

## The same rules in the assistant

The handout's question table (Maria asks after the death trigger) is tested end to end in `backend/tests/test_handout_scenarios.py`:

| Maria asks | Result | Test |
|---|---|---|
| "Did he ever write about me?" | Yes, with the number of entries and their dates; no content | `test_did_he_ever_write_about_me_gives_count_not_content` |
| "What did he write about family?" | Summaries, cited by date | `test_family_question_gives_summaries_with_dates` |
| The letter, before 2040-05-01 | Refused: not released yet, opens 2040-05-01 | `test_letter_before_release_date_is_refused` |
| The letter, on/after 2040-05-01 | Shown verbatim | `test_letter_on_or_after_release_date_is_shown_verbatim` |
| "What did he think about his business?" | Neutral reply; neither confirms nor denies | `test_business_question_is_neutral_and_does_not_confirm_entries` |
| A person with no protocol asks anything | The same neutral reply | `test_person_with_no_protocol_gets_the_same_neutral_reply` |
