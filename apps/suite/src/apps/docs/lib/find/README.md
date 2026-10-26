<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Document find and replace

Pure ProseMirror JSON operations; no editor, network, or storage dependencies.

```ts
import { findText, replaceOne, replaceAll } from "./index";

const matches = findText(document, "cat", { caseSensitive: false, wholeWord: true });
const one = replaceOne(document, "cat", "dog", 0); // zero-based match index
const all = replaceAll(document, "cat", "dog");
const original = all.changeSet.undo(all.document);
const redone = all.changeSet.apply(original);
```

`findText` returns ordered, non-overlapping `{ from, to, text }` matches. Positions
are absolute ProseMirror UTF-16 offsets (exclusive `to`), including node opening/
closing positions; the root contributes no tokens, and atoms contribute one.
These differ from the outline/anchoring library's plain-text code-point offsets.
Surrogate pairs remain intact. Adjacent text nodes are searched together regardless
of marks; blocks, hard breaks, images, and horizontal rules end a run. Attributes
and image alt text are not searchable. The first-cut schema and input bounds are
validated by the existing Docs outline validator; unsupported structures fail closed.

Case-insensitive matching defaults on and uses ECMAScript Unicode simple case folding
(`iu`); there is no normalization or multi-character case expansion. Whole-word
boundaries mean absence of an adjacent Unicode letter, mark, number, or connector
punctuation character. They do not depend on text-node boundaries.
Whole-word checks participate in greedy regex backtracking.

Set `regex: true` for the supported sequence dialect: literal code points, `.`,
nonempty character classes/ranges (including negation), `\d\D\w\W\s\S`,
escaped regex punctuation, run anchors `^`/`$`, and greedy `?`, `*`, `+`, `{m}`,
`{m,n}`, `{m,}`. Classes, dot and shorthand escapes follow ECMAScript `u` semantics;
`$` requires the exact end of the run. Repetition counts are at most 10,000.
Groups, alternation, lookaround, backreferences, other escape forms, lazy quantifiers,
and patterns that could match empty text are rejected as `unsupported-regex`.
An empty literal query returns no matches. A query is at most 512 UTF-16 units.

The matcher charges a shared step budget for each candidate start, VM state, atom
comparison, and discarded backtracking frame. Native regex executes only a single
character atom, with no repetitions. The default budget is 1,000,000 steps; set
`stepBudget` to a positive integer at most 10,000,000. Exhaustion throws
`FindError('step-budget-exceeded')` and returns no partial results or edits.

Replacements are literal strings (`$1` and `$&` have no special meaning), inheriting
the first matched character's complete marks and text-node attributes. Unmatched
text, structure and metadata retain their JSON values. Empty replacements delete
the matched text, retaining empty blocks. Replace-all uses original matches and
does not search its output. Adjacent output text nodes are left unmerged to avoid
changing unaffected leaves. Output must still satisfy the document validator.

Each replacement returns a detached document and one atomic snapshot change set.
Apply and undo require exact JSON-serialized before/after snapshots, including key
order and text-node segmentation; a stale document throws `stale-document`.
Returned documents may be mutated without changing the private snapshots. Change-set
matches describe the original document; apply/undo return fresh copies each time.
These JSON snapshots do not merge concurrent edits or integrate with Yjs history.

All rejected inputs throw `FindError` with a stable `code`; errors omit input data.
See root `QUESTIONS.md` for the conservative readings of unspecified spec details.
