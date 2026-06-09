# Upstream bug reports

Bugs found while building this app, with their fixes/reports. **All filed.**

| # | Where | Type | Status | Links |
|---|---|---|---|---|
| 1 | `rdfjs/wrapper` | library bug | issue + PR filed | [issue #78](https://github.com/rdfjs/wrapper/issues/78) · [PR #79](https://github.com/rdfjs/wrapper/pull/79) |
| 2 | `jeswr/solid-ai-coding` | doc error | fixed on `main` | [commit ad05301](https://github.com/jeswr/solid-ai-coding/commit/ad053018e7bbdc78540f3010648d2efc9e210550) |
| 3 | `solid-contrib/reactive-authentication` | docs enhancement | issue filed | [issue #7](https://github.com/solid-contrib/reactive-authentication/issues/7) |

---

## 1. `@rdfjs/wrapper` — `LiteralFrom.date` produced an invalid `xsd:date`

`LiteralFrom.date(value, factory)` tagged the literal `xsd:date` but used
`value.toISOString()` — a full dateTime lexical (`2026-07-01T00:00:00.000Z`),
which is not a valid `xsd:date` (`YYYY-MM-DD`). SHACL `sh:datatype xsd:date`
rejects it. Fix: `value.toISOString().slice(0, 10)`. PR adds `LiteralFrom`
date/dateTime tests; full suite 117 pass / 0 fail.

We worked around it locally by storing `wf:dateDue` as `xsd:dateTime`.

## 2. `jeswr/solid-ai-coding` — "patches fetch on construction" was wrong

`AGENTS.md` §Authentication and the `solid-reactive-authentication` skill said
`ReactiveFetchManager` patches `globalThis.fetch` on construction. In published
0.1.3 it does not — `registerGlobally()` is required. Corrected the prose + every
setup snippet (incl. the Next.js mount and the gotchas row). This was the most
costly trap when building against the published package.

## 3. `solid-contrib/reactive-authentication` — undocumented `registerGlobally()`

The library's README has no API docs; filed a request to document that
`registerGlobally()` is required to install the global `fetch` patch (root cause
of #2), linking the guide fix in #2.
