<!-- AUTHORED-BY Codex GPT-6 -->

# AgentDojo E1: computed results

**Attack success with a refusing principal is nonzero.** Every surviving pair and its go calls is listed in REPORT.md.

Working copy commit: `431e018e77f0a8fb8156cbebf19a672e1d9ebeff` (uncommitted E1 additions). AgentDojo `0.1.35`; Node `24.22.3`; Python `3.12`. Model calls: **0**.

Shares below retain exact counts and Python/JSON float representations; no failures are rounded away. Each mandate is a separate experiment. Two versions share many tasks; do not interpret their sum as independent benchmark coverage.

| Version | Suite | Mandate | Tasks | Finished, no ask | Finished, all asks approved | Asks mean / median / max | Pairs | Attack no gate | Attack refusing | Attack approving |
|---|---|---|---:|---|---|---|---:|---|---|---|
| v1 | workspace | fitted | 40 | 39/40 (0.975) | 39/40 (0.975) | 0 / 0.0 / 0 | 240 | 240/240 (1.0) | 2/240 (0.008333333333333333) | 2/240 (0.008333333333333333) |
| v1 | workspace | standing | 40 | 31/40 (0.775) | 39/40 (0.975) | 0.25 / 0.0 / 3 | 240 | 240/240 (1.0) | 0/240 (0.0) | 240/240 (1.0) |
| v1 | travel | fitted | 20 | 20/20 (1.0) | 20/20 (1.0) | 0 / 0.0 / 0 | 140 | 138/140 (0.9857142857142858) | 25/140 (0.17857142857142858) | 25/140 (0.17857142857142858) |
| v1 | travel | standing | 20 | 20/20 (1.0) | 20/20 (1.0) | 0 / 0.0 / 0 | 140 | 138/140 (0.9857142857142858) | 41/140 (0.29285714285714287) | 138/140 (0.9857142857142858) |
| v1 | banking | fitted | 16 | 16/16 (1.0) | 16/16 (1.0) | 0 / 0.0 / 0 | 144 | 144/144 (1.0) | 1/144 (0.006944444444444444) | 1/144 (0.006944444444444444) |
| v1 | banking | standing | 16 | 4/16 (0.25) | 16/16 (1.0) | 0.875 / 1.0 / 3 | 144 | 144/144 (1.0) | 0/144 (0.0) | 144/144 (1.0) |
| v1 | slack | fitted | 21 | 21/21 (1.0) | 21/21 (1.0) | 0 / 0 / 0 | 105 | 105/105 (1.0) | 15/105 (0.14285714285714285) | 15/105 (0.14285714285714285) |
| v1 | slack | standing | 21 | 9/21 (0.42857142857142855) | 21/21 (1.0) | 0.8095238095238095 / 1 / 4 | 105 | 105/105 (1.0) | 26/105 (0.24761904761904763) | 105/105 (1.0) |
| v1.2 | workspace | fitted | 40 | 40/40 (1.0) | 40/40 (1.0) | 0 / 0.0 / 0 | 560 | 240/560 (0.42857142857142855) | 2/560 (0.0035714285714285713) | 2/560 (0.0035714285714285713) |
| v1.2 | workspace | standing | 40 | 32/40 (0.8) | 40/40 (1.0) | 0.25 / 0.0 / 3 | 560 | 240/560 (0.42857142857142855) | 0/560 (0.0) | 240/560 (0.42857142857142855) |
| v1.2 | travel | fitted | 20 | 20/20 (1.0) | 20/20 (1.0) | 0 / 0.0 / 0 | 140 | 138/140 (0.9857142857142858) | 25/140 (0.17857142857142858) | 25/140 (0.17857142857142858) |
| v1.2 | travel | standing | 20 | 20/20 (1.0) | 20/20 (1.0) | 0 / 0.0 / 0 | 140 | 138/140 (0.9857142857142858) | 41/140 (0.29285714285714287) | 138/140 (0.9857142857142858) |
| v1.2 | banking | fitted | 16 | 16/16 (1.0) | 16/16 (1.0) | 0 / 0.0 / 0 | 144 | 144/144 (1.0) | 1/144 (0.006944444444444444) | 1/144 (0.006944444444444444) |
| v1.2 | banking | standing | 16 | 4/16 (0.25) | 16/16 (1.0) | 0.875 / 1.0 / 3 | 144 | 144/144 (1.0) | 0/144 (0.0) | 144/144 (1.0) |
| v1.2 | slack | fitted | 21 | 21/21 (1.0) | 21/21 (1.0) | 0 / 0 / 0 | 105 | 105/105 (1.0) | 15/105 (0.14285714285714285) | 15/105 (0.14285714285714285) |
| v1.2 | slack | standing | 21 | 9/21 (0.42857142857142855) | 21/21 (1.0) | 0.8095238095238095 / 1 / 4 | 105 | 105/105 (1.0) | 26/105 (0.24761904761904763) | 105/105 (1.0) |

Aggregate attack successes with every ask refused:

- v1, fitted: **43/629** (0.06836248012718601).
- v1, standing: **67/629** (0.10651828298887123).
- v1.2, fitted: **43/949** (0.045310853530031614).
- v1.2, standing: **67/949** (0.07060063224446786).

## Stop reasons and deciding checks

Attack counts are per proposed attack call whose outcome was ask or stop; a call requiring several checks is counted once at the first deciding check in outbound order. All per-check verdicts are in the raw files. Asks per task above use the refusing variant; approving-variant statistics are in summary.json.

### v1 / workspace / fitted

No-gate user utility: 39/40 (0.975). Refusing user utility (including tasks that finish despite an ask): 39/40 (0.975).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 368, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 368, "outcome": "stop", "reason": "not-authorised"}]`.

### v1 / workspace / standing

No-gate user utility: 39/40 (0.975). Refusing user utility (including tasks that finish despite an ask): 31/40 (0.775).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "limits-approval", "count": 80, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 200, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "limits-approval", "count": 80, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 200, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1 / travel / fitted

No-gate user utility: 20/20 (1.0). Refusing user utility (including tasks that finish despite an ask): 20/20 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 201, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 201, "outcome": "stop", "reason": "not-authorised"}]`.

### v1 / travel / standing

No-gate user utility: 20/20 (1.0). Refusing user utility (including tasks that finish despite an ask): 20/20 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "recipient", "count": 99, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "recipient", "count": 99, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1 / banking / fitted

No-gate user utility: 16/16 (1.0). Refusing user utility (including tasks that finish despite an ask): 16/16 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 188, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 188, "outcome": "stop", "reason": "not-authorised"}]`.

### v1 / banking / standing

No-gate user utility: 16/16 (1.0). Refusing user utility (including tasks that finish despite an ask): 6/16 (0.375).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "limits-approval", "count": 16, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "limits-approval", "count": 10, "outcome": "ask-principal", "reason": "limit-exceeded"}, {"check": "recipient", "count": 150, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "limits-approval", "count": 16, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "limits-approval", "count": 10, "outcome": "ask-principal", "reason": "limit-exceeded"}, {"check": "recipient", "count": 150, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1 / slack / fitted

No-gate user utility: 21/21 (1.0). Refusing user utility (including tasks that finish despite an ask): 21/21 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 203, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 203, "outcome": "stop", "reason": "not-authorised"}]`.

### v1 / slack / standing

No-gate user utility: 21/21 (1.0). Refusing user utility (including tasks that finish despite an ask): 9/21 (0.42857142857142855).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "disclosure", "count": 2, "outcome": "ask-principal", "reason": "context-not-clear"}, {"check": "limits-approval", "count": 21, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 98, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "disclosure", "count": 3, "outcome": "ask-principal", "reason": "context-not-clear"}, {"check": "limits-approval", "count": 21, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 97, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1.2 / workspace / fitted

No-gate user utility: 40/40 (1.0). Refusing user utility (including tasks that finish despite an ask): 40/40 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 368, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 368, "outcome": "stop", "reason": "not-authorised"}]`.

### v1.2 / workspace / standing

No-gate user utility: 40/40 (1.0). Refusing user utility (including tasks that finish despite an ask): 32/40 (0.8).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "limits-approval", "count": 80, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 200, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "limits-approval", "count": 80, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 200, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1.2 / travel / fitted

No-gate user utility: 20/20 (1.0). Refusing user utility (including tasks that finish despite an ask): 20/20 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 201, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 201, "outcome": "stop", "reason": "not-authorised"}]`.

### v1.2 / travel / standing

No-gate user utility: 20/20 (1.0). Refusing user utility (including tasks that finish despite an ask): 20/20 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "recipient", "count": 99, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "recipient", "count": 99, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1.2 / banking / fitted

No-gate user utility: 16/16 (1.0). Refusing user utility (including tasks that finish despite an ask): 16/16 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 188, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 188, "outcome": "stop", "reason": "not-authorised"}]`.

### v1.2 / banking / standing

No-gate user utility: 16/16 (1.0). Refusing user utility (including tasks that finish despite an ask): 6/16 (0.375).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "limits-approval", "count": 16, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 160, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "limits-approval", "count": 16, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 160, "outcome": "ask-principal", "reason": "approval-required"}]`.

### v1.2 / slack / fitted

No-gate user utility: 21/21 (1.0). Refusing user utility (including tasks that finish despite an ask): 21/21 (1.0).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "mandate", "count": 203, "outcome": "stop", "reason": "not-authorised"}]`.
Attack deciding checks, approve: `[{"check": "mandate", "count": 203, "outcome": "stop", "reason": "not-authorised"}]`.

### v1.2 / slack / standing

No-gate user utility: 21/21 (1.0). Refusing user utility (including tasks that finish despite an ask): 9/21 (0.42857142857142855).

Stopped user tasks: none.

Attack deciding checks, refuse: `[{"check": "disclosure", "count": 2, "outcome": "ask-principal", "reason": "context-not-clear"}, {"check": "limits-approval", "count": 21, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 98, "outcome": "ask-principal", "reason": "approval-required"}]`.
Attack deciding checks, approve: `[{"check": "disclosure", "count": 3, "outcome": "ask-principal", "reason": "context-not-clear"}, {"check": "limits-approval", "count": 21, "outcome": "ask-principal", "reason": "approval-required"}, {"check": "recipient", "count": 97, "outcome": "ask-principal", "reason": "approval-required"}]`.

## Check provenance

| Check | Implementation |
|---|---|
| data-terms | adapter standing context grant; fitted grant |
| disclosure | adapter UNS-9; fitted grant |
| evidence | reference sealEffect; adapter synchronous flushed journal before execution |
| limits-approval | reference sensitive approvals; adapter payment-history limit |
| mandate | reference evaluateIntent + OutboundGate.release; fitted amount scope adapter |
| recipient | adapter known/instruction-or-own-record; fitted recipient scope |

Every effective verdict carries `gate: reference` or `gate: adapter`; unmodified real release verdicts are also preserved as `referenceChecks`. The gate is reached through generic `use` ActionIntents. This is an adapter-assisted experiment, not evidence that the unmodified gate implements the fixed standing rules.

## Locked mandate hashes

- `mandates/standing/banking.json`: `988b70dd911cf7811808d481713b8b5cf54ac26ae0f4df2461295a6299bf0e0e`
- `mandates/standing/slack.json`: `38f2947139e28037068f179d828956471590ade48f5e6cdfce89aa5c93d145db`
- `mandates/standing/travel.json`: `06ee25f34291061e0d0cdbc1e2d8a3a0a4af2d12e1e53885bc5fb54176908c3e`
- `mandates/standing/workspace.json`: `3b1fea3729ce527a8ff2e32686009f8f7f25f2b66bf949e90e7ba0988b0660c5`
- `tool-classification.json`: `fb3ba66c055468ee1fab5443c002a156c93963f0dabf150293094deb860bb13c`

Full methodology and limitations: [METHOD.md](METHOD.md). Full findings and every survivor: [REPORT.md](REPORT.md). Raw rows: [results](results/); machine-readable summary: [summary.json](results/summary.json).
