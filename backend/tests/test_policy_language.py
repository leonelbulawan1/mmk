"""Legacy Policy Language: lexer, recursive-descent parser, interpreter, Prolog translation."""
from datetime import date
from pathlib import Path

import pytest

from app.domain.protocol import AfterDate, AfterDeath, Always, Denial, Grant, Group, LetterRelease, TopicFilter
from app.policy_lang.ast import AllowStmt, DenyStmt, GroupStmt, ReleaseStmt
from app.policy_lang.interpreter import compile_policy
from app.policy_lang.lexer import PolicySyntaxError, tokenize
from app.policy_lang.parser import parse
from app.policy_lang.to_prolog import rules_from_json, rules_to_json, translate

SAMPLES = sorted((Path(__file__).resolve().parent.parent / "app" / "policy_lang" / "samples").glob("*.alp"))
PEOPLE = {"maria", "jose", "lina"}


# ---- lexer ---------------------------------------------------------------------------------
def test_lexer_tokens_and_positions():
    toks = tokenize('allow maria summary access to entries about "family"; # note')
    kinds = [t.kind for t in toks]
    assert kinds == ["KEYWORD", "IDENT", "KEYWORD", "KEYWORD", "KEYWORD", "KEYWORD", "KEYWORD", "STRING", "SEMI", "EOF"]
    assert toks[7].value == "family" and toks[1].line == 1 and toks[1].col == 7


@pytest.mark.parametrize("src,msg", [
    ('allow x summary access to entries about "family;', "unterminated string"),
    ("allow maria summary access to entries from 2020-1-1;", "invalid date"),
    ("allow Maria summary access to entries;", "must be lowercase"),
    ("allow maria @ ;", "unexpected character"),
])
def test_lexer_errors(src, msg):
    with pytest.raises(PolicySyntaxError, match=msg):
        tokenize(src)


# ---- parser ---------------------------------------------------------------------------------
@pytest.mark.parametrize("path", SAMPLES, ids=lambda p: p.name)
def test_samples_parse_and_compile(path):
    assert len(SAMPLES) >= 3
    program, errors = parse(path.read_text())
    assert errors == [] and program.statements
    result = compile_policy(path.read_text(), PEOPLE)
    assert result.ok, result.errors
    assert result.prolog


def test_all_four_statement_types():
    src = """group kids = maria, jose;
    allow kids summary access to entries about "family" from 2010-01-01 until 2020-12-31 after 2030-01-01;
    deny jose access to entries mentioning "lina";
    release letters to maria after death;"""
    program, errors = parse(src)
    assert not errors
    types = [type(s) for s in program.statements]
    assert types == [GroupStmt, AllowStmt, DenyStmt, ReleaseStmt]
    allow = program.statements[1]
    assert allow.level == "summary" and [f.kind for f in allow.filters] == ["about", "from", "until"]
    assert allow.condition.kind == "date" and allow.condition.value == "2030-01-01"


@pytest.mark.parametrize("src,fragment", [
    ("allow maria summary access to entries", "expected ';'"),
    ("allow maria everything access to entries;", "access level"),
    ("permit maria summary access to entries;", "must start with"),
    ("deny maria to entries;", "expected 'access'"),
    ("release letters to maria;", "needs a condition"),
    ("group = maria;", "group name"),
    ("allow maria summary access to entries about family;", "quoted text"),
    ("allow maria summary access to entries after tomorrow;", "date or 'death'"),
])
def test_invalid_statements(src, fragment):
    _, errors = parse(src)
    assert errors and fragment in errors[0].message


def test_parser_recovers_and_reports_every_error():
    src = "allow maria nope access to entries;\nallow jose summary access to entries;\ndeny ;\n"
    program, errors = parse(src)
    assert [e.line for e in errors] == [1, 3]
    assert len(program.statements) == 1  # the valid middle statement survived


# ---- interpreter (semantics) -------------------------------------------------------------
@pytest.mark.parametrize("src,fragment", [
    ("allow nobody summary access to entries;", "unknown beneficiary or group 'nobody'"),
    ("group maria = jose;", "clashes with a beneficiary"),
    ("group g = maria;\ngroup g = jose;", "already defined"),
    ("group g = maria, ghost;", "unknown beneficiary"),
    ("allow maria summary access to entries from 2021-01-01 until 2020-01-01;", "later than"),
    ("allow maria summary access to entries from 2021-02-30;", "not a valid calendar date"),
    ("allow maria summary access to entries from 2020-01-01 from 2021-01-01;", "only once"),
    ("allow kids summary access to entries;\ngroup kids = maria;", "unknown beneficiary or group 'kids'"),
])
def test_semantic_errors(src, fragment):
    result = compile_policy(src, PEOPLE)
    assert not result.ok and fragment in result.errors[0]["message"]


def test_interpreter_builds_domain_rules():
    src = """group kids = maria, jose;
    allow kids verbatim access to entries about "family" after death;
    deny jose access to entries about "money";
    release letters to maria after 2030-05-01;
    allow lina existence access to entries;"""
    result = compile_policy(src, PEOPLE)
    assert result.ok
    g, a, d, r, e = result.protocol.rules
    assert isinstance(g, Group) and g.members == ("maria", "jose")
    assert isinstance(a, Grant) and a.condition == AfterDeath() and a.filters == (TopicFilter("family"),)
    assert isinstance(d, Denial) and isinstance(r, LetterRelease) and r.condition == AfterDate(date(2030, 5, 1))
    assert isinstance(e, Grant) and e.condition == Always() and e.level == "existence"


def test_warnings_for_unknown_topic_and_shadowed_allow():
    result = compile_policy('deny jose access to entries;\nallow jose verbatim access to entries about "quilting";',
                            PEOPLE)
    assert result.ok
    messages = " ".join(w["message"] for w in result.warnings)
    assert "quilting" in messages and "has no effect" in messages


def test_translation_to_prolog_facts():
    src = """group kids = maria, jose;
    allow kids summary access to entries about "family" from 2015-01-01 after 2030-01-01;
    deny jose access to entries mentioning "o'neil";
    release letters to maria after death;"""
    result = compile_policy(src, PEOPLE)
    facts = result.prolog
    assert "group_member('kids', 'maria')." in facts
    assert "rule_grant(2, 'kids', summary, [topic('family'), from(20150101)], date(20300101))." in facts
    assert "rule_deny(3, 'jose', [mention('o\\'neil')])." in facts  # quotes are escaped
    assert "rule_letters(4, 'maria', death)." in facts
    assert translate(result.protocol).startswith("% MMK policy")


def test_rules_json_roundtrip():
    result = compile_policy(SAMPLES[2].read_text(), PEOPLE)
    rules = result.protocol.rules
    assert rules_from_json(rules_to_json(rules)) == rules
