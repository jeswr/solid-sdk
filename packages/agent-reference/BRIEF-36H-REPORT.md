<!-- AUTHORED-BY Codex GPT-6.2 Sol -->

# Brief 36h report

## Ruling 34e and review fixes

The continuation guard uses private observations from the refusing agent’s inbound gate. A
statement from another issuer explains a matching value in a store or carried credential
when that gate admitted the statement and the observed digest matches. The agent’s own
packet text and effect parameters need an evidence or support citation to an eligible
statement that contains the matching value. The guard still checks refused IDs and digests
throughout, including in evidence and support citations.

The matcher now includes values in terms, including policy IDs under renamed fields. It
scans values in objects and encoded JSON. Short values that double as field names still
match whole occurrences, including `text` in the body of an approved email. Fixed policy
keywords in their protocol positions are treated as vocabulary. The same strings in
ordinary claim data and prose remain subject to the value check.

The policy-ID and approved-email parameter-name regressions reproduced the round 8 defects
at `feca047a2`. The guard tests also cover altered store and wire digests, self-issued
statements, another agent’s admission, an inbound decision short of admission, uncited
packet text, a citation that explains only one of two copied values, and cited effect
parameters. The earlier exact and re-signed JWS email cases still observe an effect release
before asserting the comparison failure.

## Invoice result

The baseline `pay-an-invoice/branch-1` reports `runs` with
`refuse / source-not-authoritative / source` at event 4. The business agent admits the
supplier’s signed invoice in gate run 5 at event 77 and stores it at event 78. P4 fails at
event 83 and the outbound gate stops payment at event 84 with `source-not-authoritative`.
The manifest update changes the row status and removes the continuation note.

The invoice trace and the `mortgage-main/a2a-task-state-lies` trace under
`transport-a2a` both reproduced byte for byte with their recorded commit metadata.

## Manifest replay

The replay covered all **283 manifest paths** in 112 scenario and configuration
combinations using the local sparq adapters. It measured **278 runs, zero disagreements
and five blocked**. All 278 executable paths produced traces, and the six saved joint trace
hashes verified. The final guard was rerun across all 15 combinations with a standalone
inbound refusal, covering 39 paths. The invoice branch was the only manifest row that moved.

## Verification

- All 112 focused tests passed with `--maxWorkers=2`, covering branch comparison, email,
  labels and both oracle files. The oracle test required the live aggregate adapter and
  matched all 163 recorded paths.
- Node 24.22.3 passed the package typecheck, Biome lint and schema export check. Biome
  reported the same 634 warnings and 528 informational diagnostics as the prior run.
- The workspace RDF discipline and agent-layer guards passed. The package RDF pipeline
  reported zero failures and 212 existing allowances.
- The 163-path oracle file has SHA-256
  `4f63d12f5e58b1d4a2f085c3d524b671663a1d96dd61c45ee875838d1308922f`.

## Evaluation text

The supplied `60-evaluation.md` is outside the writable worktree. The wording below
records the informative addition from ruling 34e for integration into that document.

> What is refused is a statement, not a value. The same value inside another statement
> that was admitted on its own, unchanged from its issuer, is that issuer’s claim and
> not a copy. A value that the agent itself writes or stores without such a statement
> behind it is a copy.
