<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Typographic input rules

`autoformatInput(textBefore, typed, { inCode, rules? })` is a pure, stateless input
rule engine. `textBefore` excludes the newly typed character. `typed` must contain
exactly one Unicode scalar value; paste and multi-character IME events should be
handled by the caller separately. The engine has no editor or browser dependency.

```ts
const input = "Example --";
const typed = "-";
const edit = autoformatInput(input, typed, {
  inCode: false,
  rules: { "single-quotes": false },
});
const text = input + typed;
if (edit) {
  const output = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  // Immediate Backspace restores the literal input, including the typed hyphen.
  const undone = output.slice(0, edit.from) + edit.original
    + output.slice(edit.from + edit.insert.length);
}
```

Edits use UTF-16 offsets into the full `textBefore + typed`, with exclusive `to`.
They carry `rule`, `from`, `to`, `insert`, and the exact `original` substring.
The caller applies the edit atomically and retains it only until the next edit or
caret movement for immediate Backspace undo. This library does not manage history.

`AUTOFORMAT_RULE_IDS` exports every supported option key, in priority order.
Rules default to enabled; `false` disables just that replacement. Only one rule
fires per call, so a fraction followed by a straight quote converts the fraction
and leaves the delimiter unchanged. Fractions require a typed non-digit on the
right and either block start or a non-digit on the left. Unicode decimal digits
count as digits. Quotes open after block start, whitespace, Unicode opening
punctuation, or Unicode dash punctuation, and close otherwise. Single quotes
after letters are closing apostrophes. Call with `inCode: true` for inline code;
valid input then always returns `null`.

`MAX_AUTOFORMAT_CONTEXT_LENGTH` is 512 UTF-16 units before typing. Longer blocks
are accepted and only their trailing window is matched; clipped surrogate pairs
are kept out of matching without changing edit offsets. The full original block
is checked for lone surrogates, so only Unicode validation scales with its length.
`MAX_TYPED_CHARACTER_LENGTH` is two UTF-16 units; the engine also checks that these
encode exactly one scalar. Length checks precede scans and copies.

All rejected inputs throw `AutoformatError` without including input data:

| Code | Meaning |
| --- | --- |
| `INVALID_TEXT` | Non-string input, lone surrogates, or typing other than one scalar |
| `UNKNOWN_RULE` | An own rule key is not in `AUTOFORMAT_RULE_IDS` |
| `INVALID_OPTIONS` | Malformed context, missing boolean `inCode`, non-boolean rule flags, or non-data options |

Context and rule maps must be plain objects (a null prototype is accepted), with
enumerable data properties. Unknown context fields and accessors are rejected;
getters are never invoked. Input validation also applies when `inCode` is true.
See root `QUESTIONS.md` for the conservative readings of unspecified details.
