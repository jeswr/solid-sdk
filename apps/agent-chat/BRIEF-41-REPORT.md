<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 41 phase 5 · agent chat

Lane 41t started at `6741268ed`. The signed counterparty message changes use the chat demo's existing pinned ES256 keys and compact JWS. The daemon receivers belong to a separate lane.

## Changes

Paths are relative to `apps/agent-chat`.

| File and line | Change |
| --- | --- |
| `src/engine/parties.ts:18` | Returns a typed refusal with a reason code and no payload or check lines. |
| `src/engine/parties.ts:36` | Uses `agent:errand` as the demo recipient and keeps seen message IDs in memory for the lifetime of the engine. |
| `src/engine/parties.ts:65` | The party signs the sender, a fresh UUID, the audience, and a 15-minute window taken from the engine clock. The signer owns these fields. |
| `src/engine/parties.ts:85` | Verifies against the pinned key before inspecting the signed payload. Requires the correct audience, a nonempty ID and parseable timestamps. Admits messages for `createdAt <= now < expiresAt` with no clock leeway. Checks and remembers authenticated, current, correctly addressed IDs before running any fitness rule. |
| `src/engine/parties.ts:126` | Reports signature and pinned-source checks on admission. Omits authority and terms and adds a fitness pass only after a supplied rule succeeds. |
| `src/engine/engine.ts:163` and `src/engine/engine.ts:259` | Shares the engine clock with the signer and receiver. The engine's existing call sites receive only admitted payloads and keep their current refusal handling. |
| `src/engine/engine.ts:1136` | Uses the common replay check for receipts and retains the task check for order reference, action digest, total and currency. |
| `src/engine/engine.ts:1580` | Describes the mortgage reply's verified pinned signature. |
| (reverted by the orchestrator) | The demo copy changes were reverted: brief 41 section 5 concerns the suite agent, not the Errand demo. |
| `test/engine.test.ts:894` | Retains the stored-receipt signature and payload assertions by verifying the evidence with the pinned test key. Inspecting a receipt requires no second admission. |

## Regression tests

All nine added cases failed against the original receiver in one run before the implementation. The fixtures used genuine ephemeral signatures and the engine's fixed test clock.

| Test | Before the change |
| --- | --- |
| `test/engine.test.ts:56` · expired at the exact expiry instant | Admitted the payload. The test expected `expired`. |
| `test/engine.test.ts:57` · created one millisecond in the future | Admitted the payload. The test expected `not-yet-valid`. |
| `test/engine.test.ts:58` · signed for another agent | Admitted the payload. The test expected `wrong-audience`. |
| `test/engine.test.ts:59` · invalid creation timestamp | Admitted the payload. The test expected `malformed`. |
| `test/engine.test.ts:60` · missing expiry timestamp | Admitted the payload. The test expected `malformed`. |
| `test/engine.test.ts:61` · missing ID | Admitted the payload. The test expected `malformed`. |
| `test/engine.test.ts:70` · same ID on repeat delivery and on a separately signed changed payload | Admitted the repeat instead of returning `replay-conflict`. |
| `test/engine.test.ts:87` · reports only checks that ran | Reported authority, terms and fitness passes for a message with no corresponding rules. Also verifies a supplied fitness rule runs and produces a pass. |
| `test/engine.test.ts:108` · signing supplies distinct IDs, audience and validity window | Signed the content and sender without the four header fields. |

The refusal tests also verify that failed integrity checks prevent the fitness callback from running.

## Commands and results

Commands ran with Node `v24.22.3` and `npm_config_offline=true`. App commands ran with `pnpm --filter @jeswr/app-agent-chat`.

| Command | Result |
| --- | --- |
| `exec vitest run test/engine.test.ts --maxWorkers=2 -t 'counterparty message admission'` | Initial attempt stopped before collection because the installed workspace dependency lacked its built entry point. After building the prerequisites, all 9 new cases failed as expected against the original implementation. |
| `pnpm --filter '@jeswr/agent-consent...' run build` | Built prerequisite libraries. Stopped the recursive build when it reached reference scenario generation, and restored its regenerated tracked traces. |
| `pnpm --filter @jeswr/agent-model run build` and `pnpm --filter @jeswr/agent-consent run build` | Passed. |
| `exec vitest run test/engine.test.ts --maxWorkers=2` | Passed all 73 cases after the receipt evidence assertion used the pinned ES256 key. |
| `run test --maxWorkers=2` | Passed all 146 cases across 3 files. Coverage passed at 95.35% statements, 89.43% branches, 97.14% functions and 97.59% lines. |
| `run typecheck` and `run build` | Both passed. |
| `exec biome check index.html package.json src/engine/parties.ts src/engine/engine.ts src/ui/App.tsx src/ui/art.tsx src/ui/chat.tsx src/ui/screens.tsx test/engine.test.ts` | Passed all 9 changed source, test and metadata files. |
| `pnpm run lint:root` | Passed the root guards, including agent and SDK layers, codegen, RDF discipline and app duplication. Root Biome reported six existing environment-variable warnings in `scripts/vercel-production.mjs`. |
| `exec playwright test --list` | Listed 14 cases, seven flows each at phone and desktop widths. |
| `PW_CHROMIUM=/usr/bin/google-chrome pnpm --filter @jeswr/app-agent-chat run test:e2e --workers=2` | The web server failed before any browser case started. Running `exec vite --host 127.0.0.1 --port 5191 --strictPort` directly confirmed `listen EPERM` at `127.0.0.1:5191`. |
| `git diff --check` | Passed. |

## Playwright demo flows

All seven flows stayed intact in `e2e/demo.spec.ts`. Browser execution was blocked at both widths by the loopback restriction.

- `e2e/demo.spec.ts:28` · shopping blocks the upsell, sets a limit, buys within it and asks over it.
- `e2e/demo.spec.ts:56` · mortgage shares only what is needed, runs a face check and presents a signed decision.
- `e2e/demo.spec.ts:74` · editing disclosure during a keyboard hold requires a fresh hold.
- `e2e/demo.spec.ts:116` · Stop cancels a pending approval.
- `e2e/demo.spec.ts:141` · platform WebAuthn registers and asserts before signing selected terms.
- `e2e/demo.spec.ts:168` · cancelled platform verification leaves edited terms unsigned and restores controls.
- `e2e/demo.spec.ts:198` · denied frame policy fails closed and the explorer demo requires opt-in.

## Scope and follow-up beads

The 15-minute lifetime is a demo default. Seen IDs last for the session, matching the lifetime of the ephemeral party keys. The existing app workflow handles gate refusals generically while `Parties.receive` provides the reason code. Workspace-wide test gates were outside the focused validation and include loopback suites. The lane ran offline, without a commit. Temporary Playwright cache directories created during validation were removed.

- File a bead under P7.4 to make the scripted mortgage index, lender catalogue, payroll and balance steps act on refused replies before displaying or continuing the corresponding workflow. Their existing fallback or scripted behavior is at `src/engine/engine.ts:1302`, `src/engine/engine.ts:1307`, `src/engine/engine.ts:1492` and `src/engine/engine.ts:1531`.
- File a bead under P7.4 to replace the separate unsigned product-page fixture's scripted inbound check labels with recorded decisions from the checks that actually run. This fixture is outside the signed counterparty path at `src/engine/engine.ts:1042`.

Tracker changes were outside this lane. Playwright validation remains pending in an environment that permits its loopback server.

## Review fixes (41u)

Lane 41u started at `81588e020`. Seven new regression cases failed against that engine and passed with the fixes below.

| Finding | Fix and regression coverage |
| --- | --- |
| Refusals consumed message IDs | The receiver records an ID after admission, including a successful fitness check when supplied. A signed receipt refused for a different order can be admitted for its matching order. Another delivery then returns `replay-conflict`. |
| Pinned senders shared an ID namespace | The receiver tracks the authenticated sender and message ID as a pair. The test admits two independently signed messages with the same ID and refuses a repeat from each sender. |
| Mortgage decisions could follow a refused bank reply | The mortgage application stops at the balance step and tells the user the reply failed verification. Expired and wrong-audience replies both block lender decision signing, the offer card and its activity entry. |
| Timestamp parsing normalized impossible calendar dates | Both signed timestamps must use a full date and time with a UTC designator or numeric offset. The parser round-trips the written calendar time before applying the offset. Tests refuse February 29 in a non-leap year and November 31, and verify the expiry boundary for a valid offset timestamp with fractional seconds. |

Shopping skips refused listings and stops at a refused receipt before recording the purchase or spend. The focused suite passed the existing receipt mismatch and replay cases.

Validation ran offline on Node `v24.22.3`. With `pnpm --filter @jeswr/app-agent-chat`, `exec vitest run test/engine.test.ts --maxWorkers=2` passed all 80 cases, `run typecheck` passed, and `exec biome check src/engine/parties.ts src/engine/engine.ts test/engine.test.ts` passed. `git diff --check` passed.
