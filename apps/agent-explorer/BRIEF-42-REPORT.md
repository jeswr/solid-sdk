<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Lane 42a — Answerable explorer syntax highlighting

The static explorer now loads a dependency-free `AX.highlight` before the explorer and Markdown renderers. It highlights JSON, JSON-LD, Turtle, TriG, N-Triples, N-Quads, SPARQL, HTTP, JavaScript, TypeScript, and shell. Without a language it detects JSON, JSON-LD, and Turtle. Plain text, unknown languages, and malformed tokens that the lexer cannot finish are escaped. Token spans preserve the source text and whitespace.

- Explore highlights the JSON-LD message and its expanded context, the Turtle or TriG view of the same graph, attachments, signed layers, stored facts, structured payment facts, settlement payloads and “As sent” data, and the raw stage pane.
- Specifications highlights fenced blocks using their language labels and preserves `data-lang`. The bundled specs contain two JSON fences, one Turtle fence, and one unlabeled architecture diagram. The diagram remains plain text.
- Inline identifiers, digests, and reason codes retain their existing rendering. Errand has no user-facing view that prints serialized JSON, JSON-LD, or Turtle, so it required no changes.

## Contrast

The seven token colors follow the existing system and explicit theme choices. The inspector, raw pane, and Markdown fences all use `--surface-2` as their background. These are WCAG relative-luminance ratios calculated from the CSS for light `#eceff3` and dark `#1c212a`. Comments use italic text.

| Token color | Light | Dark |
| --- | ---: | ---: |
| Keys, blank nodes, variables | 6.64:1 | 8.30:1 |
| Keywords, directives | 5.68:1 | 8.29:1 |
| IRIs, prefixed names | 5.40:1 | 9.12:1 |
| Strings | 5.36:1 | 10.51:1 |
| Numbers, booleans, null | 5.28:1 | 8.34:1 |
| Punctuation | 5.54:1 | 6.40:1 |
| Comments | 4.91:1 | 5.25:1 |

## Verification

- `pnpm --filter @jeswr/app-agent-explorer test` passed all 34 tests on Node 24. Coverage includes all 278 published trace documents, seven checked-in data JSON files, and all four spec fences. The largest published trace, `salary-benchmark--baseline.json` (3,483,992 bytes), highlighted in 88.1 ms against a 200 ms limit. The RDF tests adapt recorded TriG terms for N-Quads and exercise the long-string spelling of a recorded Turtle date literal.
- An offline JSDOM run compared the highlighted site against the original site. It checked token spans, exact `textContent` parity for both message forms, the context toggle, the raw pane and the spec fences, and zero console or page errors. The run used stubs for SVG geometry and verified the theme toggle.
- Biome passed for `highlight.js` and `highlight.test.mjs`. The full-app check still reported the same 460 errors and 626 warnings measured before the changes. The workspace gate stopped in `@jeswr/solid-session-restore` because TypeScript could not resolve `oauth4webapi`.
- The public and hosted-fragment builds both copied `js/highlight.js` and loaded it before its consumers. `site-files.mjs` inventories the copied directory. The explorer has no meta CSP or Vercel config that blocks the same-origin script.
- Headless Chromium could not start because the sandbox denied its socket operations. No screenshots were produced. The requested `/home/user/lanes/logs/hl-*.png` destination is also outside the sandbox’s writable roots.

The builds ran under `/tmp`. The worktree contains only source, test, and report changes. No dependency was added, no deployment was made, and the changes are uncommitted.


Claude review note: the token palette was made more saturated after a visual check (the first palette read as near-monochrome in light mode). Ratios above are against the code block background (`--surface-2`).

## Review fixes (42b)

- Audited the tokenizer regexes for overlapping failed scans. Shell parameter lookahead reuses the next closing brace or line break. HTTP comment indentation stays on the current line. JSON and JSON-LD stop scanning at the first unterminated string, including strings with many escaped quotes.
- The spec bundler checks the specs directory and accepts only regular Markdown files whose resolved paths stay in it. Symlinks and other non-file entries produce warnings. The regression fixtures use the real `docs/specs/agent` layout under a temporary root.
- The hosted artifact copies `paper/index.html` and `paper/figure-1.svg`. The regression checks that both files match their sources byte for byte.
- Eight targeted regression tests failed against the original code. The previous highlighter took 2.2–2.9 seconds on the affected 64 KiB inputs. All 50 explorer tests passed with `node --test --test-isolation=none test/*.test.mjs` on Node 24.22.3. The slowest of 169 adversarial cases took 30.3 ms against a 50 ms limit, and every case round-tripped. The largest published trace took 91.9 ms.
- Biome passed both highlighter files. Across all changed JavaScript files it reported seven existing errors, one warning and 17 informational diagnostics, down from eight errors at `HEAD`. The offline full-workspace gate stopped because `@jeswr/solid-federation-vocab` could not resolve `n3`.
