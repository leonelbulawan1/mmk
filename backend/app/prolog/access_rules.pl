/*  MMK access rules (SWI-Prolog)
    =================================

    Facts supplied per query by the Python bridge (app/prolog/engine.py):

      beneficiary(Handle).
      entry(EntryId, DateInt, Kind).          % Kind = text | letter, DateInt = YYYYMMDD
      entry_topic(EntryId, Topic).
      entry_name(EntryId, NameLowercase).
      letter_to(EntryId, Handle).
      letter_cond(EntryId, Cond).             % the letter's own release condition(s)
      group_member(Group, Handle).
      rule_grant(RuleId, Who, Level, Filters, Cond).
      rule_deny(RuleId, Who, Filters).
      rule_letters(RuleId, Who, Cond).
      death_triggered.                        % present once the owner's death trigger fired
      policy_frozen.                          % present once the policy is frozen

    Principles implemented here:
      0. Nothing while alive        - beneficiaries get no access at all until the death trigger.
      1. Deny by default            - no matching grant => none.
      2. Denial overrides           - any matching deny  => none, whatever the grants say.
      3. Levels                     - existence < summary < verbatim; the highest matching grant wins.
      4. Date-based release         - date(YYYYMMDD) conditions hold only on/after that day.
      5. Release after death        - death conditions hold only after the death trigger.
      6. Frozen policy              - can_modify_policy fails after death / freeze.
*/

:- dynamic beneficiary/1, entry/3, entry_topic/2, entry_name/2, letter_to/2, letter_cond/2, deliver_while_alive/1,
           group_member/2, rule_grant/5, rule_deny/3, rule_letters/3,
           death_triggered/0, policy_frozen/0.

level_rank(none, 0).
level_rank(existence, 1).
level_rank(summary, 2).
level_rank(verbatim, 3).

% ---- who a rule applies to -------------------------------------------------------------
applies(B, everyone) :- beneficiary(B).
applies(B, B)        :- beneficiary(B).
applies(B, G)        :- G \== everyone, group_member(G, B), beneficiary(B).

% ---- entry filters (all filters of a rule must hold: conjunction) ----------------------
filter_ok(E, topic(T))   :- entry_topic(E, T).
filter_ok(E, mention(N)) :- entry_name(E, N).
filter_ok(E, from(D))    :- entry(E, ED, _), ED >= D.
filter_ok(E, until(D))   :- entry(E, ED, _), ED =< D.

matches(_, []).
matches(E, [F|Fs]) :- filter_ok(E, F), matches(E, Fs).

% ---- release conditions ----------------------------------------------------------------
cond_ok(always, _).
cond_ok(date(D), Now) :- Now >= D.
cond_ok(death, _)     :- death_triggered.

% ---- diary entries -----------------------------------------------------------------------
best_grant(B, E, Now, Level, Id) :-
    findall(R-(Lv-Id0),
            ( rule_grant(Id0, Who, Lv, Fs, C), applies(B, Who), matches(E, Fs),
              cond_ok(C, Now), level_rank(Lv, R) ),
            Pairs),
    Pairs \== [],
    max_member(_-(Level-Id), Pairs).

%  decision(+Beneficiary, +Entry, +Now, -Level, -Reason)
decision(B, _, _, none, not_beneficiary) :- \+ beneficiary(B), !.
decision(_, E, _, none, no_such_entry)   :- \+ entry(E, _, _), !.
decision(B, E, Now, L, R) :- dated_letter(E), !, dated_letter_decision(B, E, Now, L, R).  % see below
decision(_, _, _, none, owner_alive)     :- \+ death_triggered, !.   % the diary opens only after death
decision(B, E, Now, L, R) :- entry(E, _, letter), !, letter_decision(B, E, Now, L, R).
decision(B, E, _, none, denied_by(Id)) :-
    rule_deny(Id, Who, Fs), applies(B, Who), matches(E, Fs), !.
decision(B, E, Now, L, granted_by(Id)) :- best_grant(B, E, Now, L, Id), !.
decision(B, E, Now, none, pending(Id)) :-
    rule_grant(Id, Who, _, Fs, C), applies(B, Who), matches(E, Fs), \+ cond_ok(C, Now), !.
decision(_, _, _, none, default_deny).

access(B, E, Now, Level) :- decision(B, E, Now, Level, _).

% ---- letters (all-or-nothing, only to their recipient) ----------------------------------
letter_decision(B, E, _, none, not_recipient) :- \+ letter_to(E, B), !.
letter_decision(B, E, _, none, denied_by(Id)) :-
    rule_deny(Id, Who, Fs), applies(B, Who), matches(E, Fs), !.
letter_decision(_, E, Now, none, letter_sealed) :- \+ ( letter_cond(E, C), cond_ok(C, Now) ), !.
letter_decision(B, _, Now, verbatim, released_by(Id)) :-
    rule_letters(Id, Who, C), applies(B, Who), cond_ok(C, Now), !.
letter_decision(B, _, _, none, pending(Id)) :- rule_letters(Id, Who, _), applies(B, Who), !.
letter_decision(_, _, _, none, default_deny).

% ---- dated letters ----------------------------------------------------------------------
% A letter the owner marked "deliver on this date, even while I'm alive" is the owner's own explicit release:
% it opens for its recipient on that date, whether or not the owner is alive. Nothing else opens early.
dated_letter(E) :- deliver_while_alive(E), entry(E, _, letter), letter_cond(E, date(_)), \+ letter_cond(E, death).
dated_letter_decision(B, E, _, none, not_recipient) :- \+ letter_to(E, B), !.
dated_letter_decision(B, E, _, none, denied_by(Id)) :-
    rule_deny(Id, Who, Fs), applies(B, Who), matches(E, Fs), !.
dated_letter_decision(_, E, Now, none, letter_sealed) :- letter_cond(E, C), \+ cond_ok(C, Now), !.
dated_letter_decision(_, _, _, verbatim, letter_date_reached).

% ---- policy mutability -------------------------------------------------------------------
can_modify_policy :- \+ policy_frozen, \+ death_triggered.

% ---- batch entry points used by the Python bridge ---------------------------------------
decide_all(B, Now) :-
    forall(entry(E, _, _),
           ( decision(B, E, Now, L, R), format("~w\t~w\t~q~n", [E, L, R]) )).

decide_matrix(Now) :-
    forall(beneficiary(B), decide_all_tagged(B, Now)).

decide_all_tagged(B, Now) :-
    forall(entry(E, _, _),
           ( decision(B, E, Now, L, R), format("~w\t~w\t~w\t~q~n", [B, E, L, R]) )).

report_modifiable :- ( can_modify_policy -> writeln(yes) ; writeln(no) ).
