<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Mail filter rules (MAI-L5)

Import `evaluateRules`, `dryRunRules`, `validateRules`, `MailRulesError` and the DTO
types from `index.ts`. This library returns a plan; the caller owns persistence.
There are no hooks, React, network calls, RDF changes, or added dependencies.

`MailMessage` requires complete decoded `from`/`to` string arrays, subject and
plain body strings (empty is allowed), explicit attachment presence, and original
message size in nonnegative safe-integer bytes. Address strings are opaque: the
caller supplies decoded mailbox strings or display-address strings deliberately;
the library does not extract mailboxes, parse MIME/HTML, or infer missing fields.
Empty address arrays are valid. Incomplete bodies/snippets must be resolved by the
caller before evaluation; their completeness cannot be detected from plain strings.

Text operators are literal `equals` and `contains`, case-sensitive with no trimming,
Unicode normalization, regex, or wildcard syntax. From/to match if any individual
address satisfies the condition; addresses are never concatenated. Attachment
conditions compare booleans. Size uses `equals`, strict `greater-than`, or strict
`less-than`. Nested `all`/`any` groups must be nonempty; maximum nesting is 32
(groups above a leaf). Cyclic/deeper condition trees are rejected with typed errors.

Rules run in supplied array order and always match the original message. Every
rule requires a unique nonblank ID, a condition, and at least one action. Label
adds a nonblank opaque label, move names a nonblank opaque destination folder,
mark-read sets read, and star sets starred. Labels accumulate in first-action order
without duplicates. Repeated positive actions and same-folder moves are idempotent.
Different move destinations within a rule are contradictory, as are different
moves across matching rules that would execute. Both throw `contradictory-actions`;
there is no partial returned plan. Unmatched or stopped rules do not contribute
cross-rule conflicts. Labels and folders are exact strings, never resolved as paths.

Stop processing finishes every action in its rule and prevents later rules from
contributing actions. `dryRunRules` still reports each rule's `matched` status,
including those after stop; `applied` means its actions contribute to the plan.
`evaluateRules` returns the exact same plan without the report. A neutral plan
has empty labels, null move destination/stop ID, and false flag setters. It does
not clear existing labels, folders or flags. There is no I/O in either operation.

All rules and all condition branches are validated before matching, even after a
stop or inside an otherwise short-circuited group. `validateRules` checks static
contradictions; evaluation checks conflicts among active matches. Malformed inputs,
unknown keys/operators/actions, duplicate IDs, empty groups/actions, explicit
undefined fields, sparse/decorated arrays, and non-data records (including getters)
throw `MailRulesError` with `invalid-message` or `invalid-rule`. Accepted inputs are
plain data records and dense arrays, as from JSON; null-prototype records also work.
Errors contain only stable codes, never message/rule contents. Inputs are never
mutated, and results contain fresh records and arrays.

Spec interpretation questions and conservative defaults are in root `QUESTIONS.md`.
