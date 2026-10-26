<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

1. **Scope compatibility (Task 1; “Behaviour must never get looser”).** The shared
   primitive accepts relative URLs and slashless root aliases; the old guards require
   absolute targets and reject a slashless alias of a slash-terminated base. Options:
   adopt the primitive verbatim, or preserve these restrictions in the thin delegates.
   Chosen: parse absolute targets first and permit a root only when its path exactly matches the configured base path.
   This also rejects `/alice/` as an alias of `/alice//`.
   Memory CRUD still defaults to `allowRoot: false`; listings may opt in.

2. **Redirect predicate mismatch (Task 2; “Behaviour must never get looser”).**
   unstorage's old wrapper rejects every 300–399 response with a `Location` header,
   including an empty header, except 304. The shared wrapper initially rejects only
   301/302/303/307/308 and opaque redirects. Options: leave a bespoke classifier,
   allow old refusals through, or minimally strengthen the shared wrapper to cover
   both predicates. Chosen: the shared union, with no new API. Nonstandard 3xx without
   `Location`, and all 304 responses, still pass. This necessarily also strengthens
   other users of `refuseRedirects`; follow-capable guards are unchanged.

3. **Stricter target behavior (Task 1; adversarial differential requirement).**
   The old guards accept encoded `%2f`/`%5c` path delimiters; unstorage also accepts
   embedded userinfo. Its key mapper previously permits pre-encoded separator keys.
   Options: preserve these ambiguous aliases or keep the audited guard's refusal.
   Chosen: refusal, including mapped keys carrying encoded delimiters. Safe keys,
   IDN/IPv6 equivalents, in-scope dot normalization, and query/fragment targets remain
   supported. Three existing unstorage key round-trip tests depend on encoded separators and now
   fail unchanged. The brief simultaneously requires keeping the stricter behavior
   and leaving existing tests unchanged and green. Preserve refusal and report this
   acceptance conflict; do not weaken the guard or rewrite those tests.

4. **Missing read-first skill.** `packages/guarded-fetch/SKILL.md` does not exist at
   the prescribed base, nor does a matching replacement exist in the local skill
   catalog. Options: stop, invent a skill, or use the audited implementation, README,
   and existing adversarial tests. Chosen: read those sources and proceed within scope.

5. **Redirect scope wording (Task 2 versus acceptance criterion 1).** Task 2 names
   unstorage's two wrappers in `src/scope.ts`; the acceptance wording could also
   include `solid-memory`'s private `MemoryStore.request`. Options: migrate only the
   enumerated wrappers, or broaden the task to that private request method. Chosen:
   the enumerated scope. Memory's existing method refuses *all* 3xx, including 304
   and 300 without `Location`; the shared wrapper intentionally passes those through.
   Replacing that method verbatim would loosen behavior, while adding a new shared
   policy option goes beyond the specified API. Its redirect logic is unchanged;
   a literal reading that also requires its removal remains unresolved.
