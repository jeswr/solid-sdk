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

## Review fixes (38c)

The engine has no offline resolver for a URL advertised in `Agent-Description`.
Its discovery path verifies a signed `description` message in response to
`describe`. The pilot uses the same admission path. Both treat the header as
an unverified hint with no effect on configuration. If the signed description
leads to a different selection from the discovery configuration, the runtime
returns `unsupported-configuration`. BL-6, BL-8, the pilot profile, and the
explorer describe this behavior. Normal pilot email advertises the local
HTTPS actor's `/description` address. A mail route with no usable HTTPS
address yields a blocked intent. The Gmail adapter checks the expected address
when validating a send or reconciling a provider copy.

The pilot runs signature verification before footer parity. Both bindings
derive one footer variant from the signed message and require it for a
represented principal in strict parity. Named wording requires the sender's
own description with a conformance claim in that message. Extra blank lines
fail strict pilot parity, and the engine reads only MIME parts between lines
for the declared boundary, up to the closing delimiter. BL-11 and BL-12
document the signature and parity outcomes. The link tests compare the bytes
decoded from real MIME across 20 recipients, message IDs, and conversations.
The strengthened engine test caught a temporary recipient-specific link
mutation that passed the previous test. The mutation was removed.

The filtered engine run regenerated only
`mortgage-main--transport-email.json` and
`mortgage-main--email-readable-copy-differs--transport-email.json`.
Their ten and three footer records, respectively, now describe the parity
check and the unverified header. Only those captions and the generation
metadata changed. Event counts remain 582 and 211. The explorer includes
the matching copies. The manifest still contains 283 paths, 278 runs,
zero disagreements, and five blocked paths.

- The agent-reference library-only rebuild passed. The 77 focused tests and
  three oracle tests passed with `--maxWorkers=2`. Typecheck, lint, and
  `check:rdf-pipeline` passed. Lint reported repository warnings, and the RDF
  check reported zero failures and 212 tracked exceptions.
- All 43 personal-agent email, outbound, and transmission tests passed with
  `--maxWorkers=2`. Its typecheck and lint passed.
- All 20 explorer Node tests passed. The engine trace import and
  `node scripts/bundle-data.mjs` succeeded. The bundled baseline and all 13
  revised captions matched the source.

## Review fixes (38d)

- Inbound integrity verification leaves the credential cache untouched. The runtime
  captures carried bytes before dispatch and publishes them after successful admission.
  Restart restores inbound bytes only from records marked as admitted. Older inbound
  records lack this marker, so a new message must carry the full credential before a
  later message can cite it by digest. The regression compares a later citation with
  a clean runtime after footer parity, audience, and profile refusals. It also checks
  that an admitted credential resolves both immediately and after restart. Restoring
  the early cache write made the footer case admit the citation incorrectly.
- Gmail reconciles uncertain sends against the reviewed MIME, including the absence of
  `Agent-Description` and the exact rendering used before the footer was introduced.
  Current header and footer requirements still apply to new attempts. Tests recover an
  original provider copy, reject copies with an added header or changed rendering, and
  verify that the provider received only one send request in each case.
- The pilot advertises its configured `descriptionUrl` verbatim. The header is optional
  when the agent has no configured address. Both bindings accept its absence, and BL-6,
  the pilot profile, and the explorer bundle reflect that behavior.
- `buildEmail` now returns a promise because it decodes the attached RDF wire document.
  It checks agreement with the supplied message before using the decoded document to
  render both MIME alternatives. The regression pairs a named description with wire
  that carries no conformance claim and checks that the builder refuses it.

The two fresh `mortgage-main` email runs match the committed traces after excluding
generation metadata. The main run has 582 events and the readable-copy fault branch
has 211. Both manifests remain at **283 paths, 278 runs, zero disagreements, and five
blocked**. The explorer bundle includes the revised BL-6.

- The agent-reference library-only rebuild, 82 focused tests, three oracle tests,
  typecheck, lint, and `check:rdf-pipeline` passed. Lint reported repository warnings.
  The RDF check reported zero failures and 212 tracked exceptions.
- All 47 personal-agent email, outbound, and transmission tests passed, along with
  typecheck and lint. The Vitest runs used `--maxWorkers=2`.
- All 20 explorer Node tests and `node scripts/bundle-data.mjs` passed.

## Review fixes (38e)

- The runtime refuses an unsupported profile before creating replay, conversation,
  identifier, or credential state. The regression sends a valid opener from a different
  pinned peer on the same conversation and compares its decision and reply with a clean
  runtime. It also compares the stored state before and after the refusal.
- The configured `Agent-Description` address is excluded from the known-identifier
  registry. The payment regression verifies that the reference check fails for that
  URL and that an admitted invoice reference reaches the payment adapter.
- Gmail records the SHA-256 digest of the reviewed MIME before sending. After restart,
  replacement reviews with a changed subject or historical footer cannot reconcile
  against matching provider copies. The original MIME still reconciles. Attempts made
  before MIME digests use the recorded envelope and original review, including
  headerless messages from before the footer was introduced.
- `buildEmail` binds a resolver before comparing the decoded packet with the supplied
  message. The regression builds MIME from a signed credential-by-digest packet and
  verifies the rendered output.
- Restart restores legacy inbound credentials when the ledger records their admission
  and backfills the admission marker. The tests also cover a legacy refusal whose
  transport disposition was accepted because it issued an unsupported-configuration
  response.

Each regression reproduced its finding on `84343be6f`. Both recorded mortgage email
traces matched fresh in-memory runs after excluding generation metadata. The main run
has 582 events and the readable-copy fault branch has 211. The manifest remains at
**283 paths, 278 runs, 0 disagreements, and 5 blocked**.

- The agent-reference library-only rebuild, 92 focused tests, three oracle tests,
  typecheck, lint, and `check:rdf-pipeline` passed. Lint reported existing warnings.
  The RDF check reported zero failures and 212 tracked exceptions.
- All 50 personal-agent email, outbound, and transmission tests passed, along with
  typecheck and lint. Both Vitest runs used `--maxWorkers=2`.
