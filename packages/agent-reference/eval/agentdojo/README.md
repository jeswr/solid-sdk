<!-- AUTHORED-BY Codex GPT-6 -->

# AgentDojo replay without a model (E1)

[SUMMARY.md](SUMMARY.md) contains computed results; [REPORT.md](REPORT.md) lists limitations
and every surviving attack. [METHOD.md](METHOD.md) fixes the interpretation. No network,
model key or model invocation is needed. All benchmark function execution is local.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/agent-reference exec tsc -p tsconfig.build.json
pnpm --filter @jeswr/agent-reference exec vitest run --config src/eval/vitest.config.ts
PYTHONPATH=/root/.local/share/uv/tools/pytest/lib/python3.13/site-packages \
  packages/agent-reference/eval/.venv/bin/python -m pytest packages/agent-reference/eval/agentdojo -q
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/run.py
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/audit.py
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/report.py
pnpm --filter @jeswr/agent-reference run lint
pnpm --filter @jeswr/agent-reference run typecheck
pnpm --filter @jeswr/agent-reference run test
```

The PYTHONPATH uses this sandbox's existing pytest installation with the benchmark's
Python 3.12; on another machine, provide pytest in that interpreter's environment.
`run.py` defaults to both v1 and v1.2, overwrites results deterministically and regenerates
ignored write-ahead journals in `cache/`. Optional `--version v1`/`--version v1.2` selects
a version and produces a partial summary. No user or injection tasks are sampled.

Do not rerun `freeze.py`: it refuses to overwrite the preregistration. The existing lock
must continue to verify. Reclassifications require a separately declared experiment,
not modifications of this evaluation's standing data. Fitted grants are generated from
user ground truth, independently of attack calls.

Each raw results file has one utility row per user task and one attack row per Cartesian
pair, with separate no-gate, refusing and approving variants. Each call records its
arguments, class, recipients and known/instruction flags, context IDs, outcome, registry
reason, per-check implementation origin and execution result. The final context stores
the observed snapshot values. A go is journalled before execution; approved asks retain
the original ask outcome plus the simulated principal decision. `referenceChecks` retains
the unmodified release verdicts, including checks replaced by adapter verdicts.
