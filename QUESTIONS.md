<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MUS-L4 questions and conservative assumptions

1. The MUS-L4 task and specs/apps/12-pure-libraries-4.md do not define operator names,
   string matching, empty groups, or nested groups. Options: implicit case folding/nesting,
   or a small explicit flat schema. Use flat `all`/`any`, exact case-sensitive `eq`/`ne`
   and `contains`/`startsWith`/`endsWith` for text; `eq`/`ne`/`lt`/`lte`/`gt`/`gte` for
   numbers. Empty all matches all, empty any matches none. Reject unsupported structures.
2. Specs/apps/07-parity-backlog.md Music and MUS-L4 do not define genre/year/rating
   projection or missing play statistics. Options: infer defaults/history or accept explicit
   metadata. Extend the existing LibraryTrack structurally inside smart/ only: album means
   albumTitle, genre is one string, year is 1–9999, rating is a finite 0–5 number (fractional
   allowed), playCount is a nonnegative safe integer, lastPlayedAt is integer epoch milliseconds
   within the Date range. Optional missing metadata never matches, including ne; no defaults,
   date parsing, rating conversion or history aggregation is inferred.
3. MUS-L4 does not specify sort/limit defaults. Options: random/multiple sort keys or one
   explicit field/direction. Use one sort over title or any rule field, asc/desc; exact
   code-unit text ordering, unknowns last in either direction, exact track ID to break ties.
   Without sort preserve library order. Limit is a nonnegative safe integer applied after
   filtering/sorting (zero yields empty). Re-evaluation is an ordinary pure function call.

These choices are documented for dispatcher review; none blocks implementation. UI mockup,
fixture-route and screenshot requirements do not apply to this pure-library-only task.
