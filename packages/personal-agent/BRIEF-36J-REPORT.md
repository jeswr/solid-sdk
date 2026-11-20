<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36j — Personal-agent pilot recovery

## Root cause

The FHIR pilot signed `PatientAuthorisation` with the patient’s owner key and named the patient in `patient`. It omitted `issuer`. When the integrated runtime projected the JWS into an embedded credential, it required a safe issuer IRI from `issuer`, `party`, or a profile-specific `iss`. Consent therefore failed while the proposal was built, before the authorisation service could decide the request. Existing FHIR access grants and the industrial and mortgage credentials already name their issuers. [`agent-reference/src/model/evidence-item.ts:79`](../agent-reference/src/model/evidence-item.ts#L79)

Several other failures had independent causes. Email and public HTTP expected legacy wire formats even though the runtime now emits complete JSON-LD packets. The old security fixtures also looked for a compact outer JWS and could fail to tamper with the actual proposal. Two state-correlation tests attempted to clone live RDF wrappers with `structuredClone`. Restoring the correct carriage let the industrial refusal reach the caller and restored progress in the in-process Gmail and mortgage workflows.

## Changes

- The health role, in-memory scenario, and durable test fixture sign the patient’s existing party IRI as `issuer`. The authorisation service checks equality of the pinned signer, claimed issuer, and patient before applying the existing client, audience, scope, and enrollment checks. The durable test presents a consent signed by Maya that names Noah as issuer and checks the refusal. [`roles/health.ts:179`](src/pilot/roles/health.ts#L179), [`scenarios/fhir.ts:186`](src/pilot/scenarios/fhir.ts#L186), [`domains/fhir.ts:66`](src/pilot/domains/fhir.ts#L66), [`domains/fhir.ts:435`](src/pilot/domains/fhir.ts#L435), [`health-durable.test.ts:396`](src/pilot/health-durable.test.ts#L396), [`health-durable.test.ts:427`](src/pilot/health-durable.test.ts#L427)
- The document carriage helper validates the packet wrapper and distinguishes proof presence from proof verification. Direct-envelope delivery uses the engine’s bounded size allowance for the serialized document and attachments. The legacy parser retains its original limits, as do the SMTP-style MIME, A2A, and public HTTP ingress limit checks. [`bindings/message-packet.ts:13`](src/pilot/bindings/message-packet.ts#L13), [`host.ts:300`](src/pilot/host.ts#L300), [`service.ts:310`](src/pilot/service.ts#L310)
- Email carries the exact signed document and attachments in a bounded gzip/base64url wrapper. A scheduling packet reached roughly 384 KB when carried uncompressed in both MIME copies. Compression preserves the existing MIME size ceiling. Inbound parsing awaits the engine’s document projection for human parity. Review, Gmail send, and provider reconciliation check the exact packet, the pinned audience and recipient, the derived Message-ID, and all visible parts. Compact JWS carriage remains supported. The email parsing, outbound validation, and provider-copy helpers now return promises. [`bindings/message-packet.ts:20`](src/pilot/bindings/message-packet.ts#L20), [`bindings/email.ts:205`](src/pilot/bindings/email.ts#L205), [`bindings/email.ts:442`](src/pilot/bindings/email.ts#L442), [`bindings/email.ts:590`](src/pilot/bindings/email.ts#L590), [`bindings/email.ts:647`](src/pilot/bindings/email.ts#L647), [`bindings/gmail.ts:179`](src/pilot/bindings/gmail.ts#L179), [`bindings/gmail.ts:287`](src/pilot/bindings/gmail.ts#L287), [`service.ts:199`](src/pilot/service.ts#L199), [`service.ts:334`](src/pilot/service.ts#L334), [`email.test.ts:120`](src/pilot/email.test.ts#L120), [`outbound.test.ts:240`](src/pilot/outbound.test.ts#L240)
- Public HTTP accepts proof-free JSON-LD requests and proof-carrying JSON-LD replies. The reply spool preserves the complete packet for crash recovery. The dispatcher retains identical retry semantics for unsigned requests. Signature, identity, evidence, and public-operation admission stay with the runtime. [`bindings/public-http.ts:66`](src/pilot/bindings/public-http.ts#L66), [`bindings/public-http.ts:312`](src/pilot/bindings/public-http.ts#L312), [`bindings/public-http.ts:501`](src/pilot/bindings/public-http.ts#L501)
- Both public reply crash cases exposed an audit checkpoint gap. The engine checkpoints the audit prefix with runtime state and discards an uncommitted suffix on recovery. The binding now commits its receipt and processing observations before the two fault boundaries. An engine file-store test checks that recovery retains committed observations and removes an uncommitted one. [`bindings/public-http.ts:422`](src/pilot/bindings/public-http.ts#L422), [`bindings/public-http.ts:544`](src/pilot/bindings/public-http.ts#L544), [`agent-reference/src/runtime/agent.ts:1542`](../agent-reference/src/runtime/agent.ts#L1542), [`agent-reference/test/email.test.ts:785`](../agent-reference/test/email.test.ts#L785)
- The demo and security tests now change the meeting terms in the actual JSON-LD proposal and submit it with the original proof. Replay and downgrade fixtures also exercise JSON-LD. The A2A tamper test modifies the signed expiry and still expects `bad-signature`. The correlation tests compare detached snapshots of the RDF-backed state with `copyData`. [`scenarios/personal-cases.ts:219`](src/pilot/scenarios/personal-cases.ts#L219), [`security.test.ts:75`](src/pilot/security.test.ts#L75), [`security.test.ts:106`](src/pilot/security.test.ts#L106), [`security.test.ts:237`](src/pilot/security.test.ts#L237), [`a2a.test.ts:379`](src/pilot/a2a.test.ts#L379), [`delivery-correlation.test.ts:370`](src/pilot/delivery-correlation.test.ts#L370), [`delivery-correlation.test.ts:440`](src/pilot/delivery-correlation.test.ts#L440)
- The engine returned early on a failed document proof and lost the verification audit record that the compact path provided. The native gate now records a bad signature or unknown key against the document digest before returning the same rejection. The regression test covers valid attribution and refusal with no attribution. The engine continues to require a safe issuer IRI. [`agent-reference/src/gates/inbound.ts:338`](../agent-reference/src/gates/inbound.ts#L338), [`agent-reference/test/runtime-graph-ingress.test.ts:91`](../agent-reference/test/runtime-graph-ingress.test.ts#L91)

## Expected outcomes and test budgets

- The expected representation for anonymous energy requests is now `awp-jsonld/0.1` without an outer proof. The engine’s native emitter uses the same packet format for signed and unsigned messages. The durable test still checks that the sender is empty, and the scenario still checks that there is no carried evidence. [`energy-durable.test.ts:166`](src/pilot/energy-durable.test.ts#L166), [`scenarios/energy.ts:110`](src/pilot/scenarios/energy.ts#L110), [`agent-reference/src/runtime/agent.ts:8898`](../agent-reference/src/runtime/agent.ts#L8898)
- The expected consent-decision count increases from eight to nine because the test now submits an extra consent with a mismatched issuer. The sequence of successful grants stays the same. [`health-durable.test.ts:515`](src/pilot/health-durable.test.ts#L515)
- Each of the seven malformed provider results now runs as a separate test with the same refusal and durable uncertainty assertions. This removes the shared 5-second test budget across seven independent negotiations. [`transmission.test.ts:624`](src/pilot/transmission.test.ts#L624)
- The CLI, Gmail round trip, energy, health, mortgage, and industrial store cases have 20-second Vitest execution budgets. The multi-hop industrial case has 45 seconds and the 14-scenario demo has 120 seconds. Signature verification and RDF materialization exceeded the previous test-runner budgets during verification. These budgets apply only to test execution. [`cli.test.ts:208`](src/pilot/cli.test.ts#L208), [`email.test.ts:101`](src/pilot/email.test.ts#L101), [`energy.test.ts:36`](src/pilot/energy.test.ts#L36), [`fhir.test.ts:65`](src/pilot/fhir.test.ts#L65), [`industrial.test.ts:84`](src/pilot/industrial.test.ts#L84), [`industrial.test.ts:186`](src/pilot/industrial.test.ts#L186), [`mortgage.test.ts:68`](src/pilot/mortgage.test.ts#L68), [`demo.test.ts:13`](src/pilot/demo.test.ts#L13)

## Verification

All test runs used Node 24 and at most two Vitest workers. The worktree was exercised offline.

| Run | Result |
| --- | --- |
| Baseline `src/pilot` | 134 passed, 75 failed, one unhandled loopback error across 33 files. The supplied CI log reported 61 failures across 19 files in the full suite. |
| Final full personal-agent suite | 498 passed, 77 failed, 4 skipped after a setup failure, and 2 unhandled loopback errors. Of 58 files, 42 passed and 16 failed. The 215 pilot tests accounted for 182 passes and 33 failures. |
| Engine library rebuild | `tsc -p tsconfig.build.json` and `node scripts/copy-generated.mjs` passed. |
| Engine graph ingress, runtime packets, and email audit | 39 passed across 3 files. |
| Engine `test/oracle` | 3 passed across 2 files. |
| Public HTTP with in-process transport | 4 passed across 2 temporary test files. The run exercised the public handler, durable spool, restart, retry, and energy workflow. |
| A2A with in-process transport | 5 selected tests passed across 2 temporary test files. The run exercised scheduling, document tampering and replay, queued mortgage approval expiry, and both queued health grant refusals. |
| Conventional adapter and full demo with in-process transport | 2 passed across 2 temporary test files. All 14 demo scenarios passed. |
| Personal-agent typecheck and lint | Passed. |

The sandbox denies loopback listeners with `listen EPERM` and fixture subprocess calls with `spawnSync EPERM`. The 33 pilot failures stopped at those dependencies or timed out waiting for them. They comprise 14 A2A cases, four protected-disclosure cases, four public HTTP cases, seven policy-fixture cases, one MCP FIFO case, one provider HTTP case, and the conventional-adapter case plus its demo check. The demo’s other scenario checks passed in the full run. The 44 other failures were in credential, provider-helper, and dashboard tests.

## Summary

The pilots sign patient consent with an explicit issuer, exchange native message packets, and retain reply audit observations across restart. The engine oracle and the in-process recovery checks pass. Real loopback and subprocess verification still depends on a runner that permits those operations.

## Review fixes (36m)

- Gmail outbound revalidation uses the same MIME extraction, carrier bounds, and packet decoding as inbound parsing. It compares the decoded packet with the reviewed packet and checks the attachment and human renderings against the decoded carrier. The two regression cases exercise the 512 KiB expanded packet cap and the 64 KiB carrier cap independently. Both messages fit under the pilot's default 256 KiB MIME limit. [`bindings/email.ts:390`](src/pilot/bindings/email.ts#L390), [`bindings/email.ts:443`](src/pilot/bindings/email.ts#L443), [`bindings/email.ts:607`](src/pilot/bindings/email.ts#L607), [`email.test.ts:124`](src/pilot/email.test.ts#L124)
- The engine refuses an unsigned public request that names an operator. Both native and legacy engine cases pair the refusal with a successful request whose sender is empty. [`agent-reference/src/gates/inbound.ts:523`](../agent-reference/src/gates/inbound.ts#L523), [`agent-reference/test/runtime-graph-ingress.test.ts:27`](../agent-reference/test/runtime-graph-ingress.test.ts#L27)
- The energy scenario requires proof-free native JSON-LD carriage as part of its identity-free request assertion. The regression delivers follow-up invocations using legacy unsigned carriage and shows that the scenario flags the format even though the service completes the invocation. [`scenarios/energy.ts:112`](src/pilot/scenarios/energy.ts#L112), [`energy.test.ts:40`](src/pilot/energy.test.ts#L40)
- A canary startup error rejects the startup promise and closes the already-started booking service. The test injects an asynchronous listen error and expects rejection before the next event-loop turn. The demo uses its original 60-second budget. [`scenarios/conventional.ts:64`](src/pilot/scenarios/conventional.ts#L64), [`scenarios/conventional.ts:352`](src/pilot/scenarios/conventional.ts#L352), [`conventional.test.ts:8`](src/pilot/conventional.test.ts#L8), [`demo.test.ts:13`](src/pilot/demo.test.ts#L13)

All six new regression cases failed at the intended assertions before their fixes. Verification used Node 24 offline and at most two workers per Vitest run.

| Run | Result |
| --- | --- |
| Personal-agent email, Gmail outbound, energy, and security | 27 passed across four files. |
| Gmail transmission and provider-copy checks | Three selected tests passed. |
| Canary startup failure | One selected test passed. |
| Conventional scheduling and full demo with in-process HTTP transport | Two tests passed. All 14 demo scenarios passed in 37.6 seconds. |
| Personal-agent typecheck and lint | Passed. |
| Agent-reference library rebuild | `tsc -p tsconfig.build.json` and `node scripts/copy-generated.mjs` passed. |
| Agent-reference graph ingress, runtime packets, and anonymous paths | 10 passed across four files. |
| Agent-reference `test/oracle` | Three tests passed across two files. All 163 recorded scenario paths matched the oracle. |

Real loopback and fixture subprocess tests are reserved for the orchestrator's runner.
