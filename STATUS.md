<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ild.1 lane status

Branch: `lane/sst-ild.1`. Base: `0d8842080a31b716b2d1350efed53b19eb8c6832`.

## Commits and behavior

- `fde5e131` — `fix: map vCard organization components`: map the first ORG component
  to `ContactData.organization`; split before TEXT unescaping; retain organisational
  units in the existing `Organization: unit — unit` note format and preserve NOTE.
  Remove the stale model-gap comments. Add fixture and RDF injection regressions.
- `6ac98adc` — `test: cover contact organization fields`: test the existing
  Organisation SHACL field, typed contact merge, and secondary list text. Cover
  reading, adding, editing, clearing, absent values, hostile text, preserved contact
  fields, minted form subjects, and conditional writes.
- Final documentation commit — `docs: record sst-ild.1 lane status` (this file).

The base already contains the Organisation form field, `Contact.organization`
read/write mapping, and list rendering. Those implementations are retained and
covered with focused tests rather than duplicated. The bridge is import-only;
there is no contact-to-vCard direction to update. The package-local `SKILL.md`
files named in the brief do not exist in this checkout; shared test and review
skills were read.

Conservative choices: retain the first ORG property's precedence, trim components
as before, retain the note prefix for units, and never promote a unit into an empty
organisation name. Escaped semicolons remain inside their component, following
[RFC 6350 section 3.4](https://www.rfc-editor.org/rfc/rfc6350.html#section-3.4).

## Security property and evidence

The changed untrusted-input path stores the imported organisation name as a
`vcard:organization-name` string literal instead of including it in the note.
The security property of that path is that organisation text cannot create RDF
statements, DOM elements, or executable links. The components' authorization,
credential routing, scope guards, and conditional-write policy are unchanged.

The bridge tests round-trip a forged-RDF-looking ORG through `serializePerson`
and `parseRdf`, assert the exact organisation value, and reject the forged subject.
Fixtures cover escaped semicolons/commas, odd/even backslash runs, newline escapes,
trailing and unknown escapes, NUL stripping, empty names/units, repeated ORG, and
absent ORG. The component tests render HTML and `javascript:` payloads as text,
assert no injected elements/links, and save hostile text through the real
conditional merge and serialization path. Save tests assert `If-Match`, preserve
emails/phones/WebID/notes/UID/created, remove a cleared organisation predicate, and
exclude the form's minted subject from the saved graph.

The form tests mock the upstream widget's `toRDF`/validation seam, matching the
repository's existing jsdom testing approach; the wrapper, typed accessors,
DataWriter, fetch boundary, RDF parsing and serialization remain real. All test
network seams use local mocks.

Regression sensitivity was checked with temporary mutations, restored afterward:
removing the form organisation setter caused four failures; removing the shape
field caused three; removing list organisation rendering caused five. Running the
initial mapper tests against the original mapper caused eleven expected failures
before the additional malformed-input cases were added.

## Validation

Commands ran with `export PATH=/opt/node24/bin:$PATH` (Node `v24.22.1`, pnpm
`10.4.1`), with lifecycle scripts left disabled.

| Exact command | Result |
| --- | --- |
| `pnpm exec turbo run build --filter=@jeswr/solid-dav-bridge... --filter=@jeswr/solid-components... --concurrency=4` | PASS: bootstrap dependency-first builds, 9 tasks. |
| `pnpm --filter @jeswr/solid-dav-bridge run lint && pnpm --filter @jeswr/solid-dav-bridge run build && pnpm --filter @jeswr/solid-dav-bridge run typecheck && pnpm --filter @jeswr/solid-dav-bridge run test` | PASS: all four steps; 6 test files, 127 tests. Lint reports existing warnings. |
| `pnpm --filter @jeswr/solid-components run lint && pnpm --filter @jeswr/solid-components run build && pnpm --filter @jeswr/solid-components run typecheck && pnpm --filter @jeswr/solid-components run test` | Lint/build/typecheck PASS. Tests: 21 files and 212 tests pass; packaged-dist smoke suite fails in its setup with `spawnSync /opt/node24/bin/node EPERM`, leaving its 4 tests unexecuted. |
| `pnpm --filter @jeswr/solid-components exec vitest run test/contact-form.test.ts test/contact-list.test.ts` | PASS: 2 files, 17 tests. |
| `pnpm run lint:root` | PASS, including workspace/layer/fetch/token/contrast guards. |
| `TURBO_SCM_BASE=0d8842080a31b716b2d1350efed53b19eb8c6832 pnpm run gate` | FAIL: same packaged-dist smoke `spawnSync EPERM`; 14 successful Turbo tasks before termination. Bridge's 127 tests and components' 212 executable tests pass. |
| `pnpm run gate:full` | FAIL: `//#test:root`, 169 root guard fixture test failures involving empty child-process output and timeouts; 75 successful Turbo tasks before termination (259 tasks planned). These tests and guard scripts are unchanged by this lane. |
| `git diff --check` | PASS. |

The subprocess error also reproduces outside Vitest with:

```sh
node --input-type=module -e 'import {execFileSync} from "node:child_process"; console.log(execFileSync(process.execPath,["--version"],{encoding:"utf8"}));'
```

This fails with the same `spawnSync /opt/node24/bin/node EPERM`, independently of
the package code. No test exclusions or gate relaxations were committed.

Supply-chain check: no dependencies, manifests, or lockfiles changed, so
`pnpm run check:packages <name>` is not applicable. No packages were installed.

## Unfinished validation and questions

Implementation is complete. A green component/affected gate remains blocked by
the environment's synchronous child-process error. The full gate also stops on
unchanged root guard fixtures (empty child-process output and timeouts); their
underlying cause was not established. `roborev --version` exits 127
(`command not found`), so automated per-commit verdicts could not be obtained.
These checks must be completed in a suitable environment before Jesse merges;
this security-critical work must never be auto-merged.

No open design questions. No pushes, PRs, publishing, branch switches, remote
fetches, other-checkout changes, or tracker mutations were performed.
