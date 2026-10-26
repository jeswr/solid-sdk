<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-7098 — conservative interpretations

1. `05-docs §4.8` and `13-pure-libraries-5` do not specify the regex dialect,
   word-boundary rule, or empty-match behaviour. Options are a full engine dependency
   or a bounded subset. This lane uses a dependency-free sequence dialect: literals,
   dot, character classes/ranges, `\d\D\w\W\s\S`, escaped punctuation,
   `^`/`$`, greedy `?`/`*`/`+`/`{m}`/`{m,n}`/`{m,}`. Groups, alternation,
   lookaround, backreferences, lazy quantifiers, and nullable patterns are typed
   errors. Whole words use Unicode letters, marks, numbers, and connector punctuation.
   Empty literal queries return no matches. Replacement strings are literal.
2. `05-docs §4.8` does not specify cross-structure matching or position units.
   Options are a flattened document projection or contiguous editable text runs.
   This lane searches across adjacent marked text leaves, stopping at hard breaks,
   atoms, and block boundaries. Results use absolute ProseMirror UTF-16 positions,
   with an exclusive end. No surrogate pair can be split.
3. `05-docs §6.2` describes editor undo, while this lane is a pure JSON library.
   Options are editor transactions or detached snapshot changes. This lane returns
   one atomic snapshot change set with apply/undo and exact snapshot preconditions;
   Yjs integration remains in the editor task.
