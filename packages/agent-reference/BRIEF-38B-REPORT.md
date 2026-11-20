<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 38b implementation report

## Email and explorer

The engine and personal-agent pilot share the neutral and named footer renderers.
Email still uses the `email-mime/0.1` binding. The engine chooses the named wording
from its own description's conformance claims. The pilot defaults to neutral and
lets a caller with a conformance claim select named. Messages without a represented
principal omit the footer.

The engine checks the readable copy after verifying the signature and records a
transport note for each matching footer. The pilot checks that the same variant
appears in both MIME alternatives. Outbound and provider-copy validation check the
caller's expected footer and optional HTTPS `Agent-Description` header. The pilot
surfaces that header as an unauthenticated observation. The offline agents negotiate
with the existing signed description exchange. Fetching and verifying a hosted
description from the header is the behavior specified by BL-6 and BL-8.

The explorer's `#/start` page explains the footer and links to `#/get-an-agent`.
Home and the navigation link directly to setup. Recorded MCP and A2A runs appear
when present, and Errand uses the same availability probe on Home and setup.
The bundled Specs view includes BL-6, BL-11 through BL-13, and the transport
parity clause. Roadmap items P7.2 and P7.3 are marked done.

## Recorded traces

Ran `node scripts/run-scenarios.mjs --scenario=mortgage-main --configuration=transport-email`
from `packages/agent-reference`. The runner executed two paths. The manifest remains
at **283 paths, 278 runs, 0 disagreements, and 5 blocked**.

| Engine trace | Recorded change |
| --- | --- |
| `mortgage-main--transport-email.json` | Ten standard-footer transport notes, increasing the event count from 572 to 582. |
| `mortgage-main--email-readable-copy-differs--transport-email.json` | Three standard-footer notes for earlier valid emails, increasing the event count from 208 to 211. The altered readable copy still produces `human-parity-mismatch`. |

After excluding the added notes and renumbered sequence fields, every event in
both traces matches the previous recording. The generator stamped the current
base commit, `72d380efa`. The trace index now lists the new event counts, and the
main run's manifest row refers to the renumbered consequences. The explorer's
engine importer refreshed the two matching copies and its manifest, and the
bundle was rebuilt.

## Verification

- Agent reference library rebuilt with `npx tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`.
- Agent reference footer and carriage suites passed all 24 tests. The oracle
  command `npx vitest run test/oracle --maxWorkers=2` passed all 3 tests.
- Agent reference typecheck, lint, and `check:rdf-pipeline` passed. Lint reported
  repository warnings. The RDF check reported zero failures and 212 tracked exceptions.
- Personal-agent email, outbound, and provider transmission suites passed all
  38 tests. Personal-agent typecheck and lint passed.
- Explorer passed all 18 Node tests. The engine import and `node scripts/bundle-data.mjs`
  succeeded. The rebuilt site was loaded in an offline JavaScript harness to
  verify both routes, Home fallback, both Errand probe outcomes, the bundled
  clauses, and the roadmap statuses.
- The 360 px light and dark browser check remains open. Chromium stopped at
  startup when the sandbox denied a process operation. The workspace-wide gate
  was deferred under the focused-test and library-only-build instructions.

## Tracker follow-ups for the orchestrator

- Enforce BL-9 against stepping down within a conversation and require principal
  approval for a weaker configuration in a new conversation with the same party.
- Build the adapter package that puts both gates around an existing assistant.
- Decide whether the footer link may ever be configurable (`needs:jesse`).
