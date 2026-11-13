<!-- AUTHORED-BY Codex GPT-6 -->

# AgentDojo E2 harness

E2 puts a real model behind E1's frozen policies. No real model has been called while
building this harness. [E2-SUMMARY.md](E2-SUMMARY.md) is the empty-results report; a measured
report is generated beside each run's rows when the run finishes. All people, data and
tool effects belong to AgentDojo's fictional local environments.

Use AgentDojo 0.1.35 in E1's existing virtual environment. No dependency installation,
API key, or API client is needed. The model process uses the shared-login Codex wrapper
specified in Brief 19. The caller must already have that wrapper and its login available.

From the repository root, prepare the existing bridge if its ignored build output is
missing or stale:

```sh
PATH=/opt/node24/bin:$PATH pnpm --filter @jeswr/agent-reference exec tsc -p tsconfig.build.json
```

Then the pilot is one command:

```sh
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/e2/run_e2.py --model gpt-6.1-sol --effort low --conditions none,fitted,standing --pilot --jobs 4 --resume
```

The full run uses the same cache and rows, skipping pilot rows that are already present:

```sh
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/e2/run_e2.py --model gpt-6.1-sol --effort low --conditions none,fitted,standing --jobs 4 --resume
```

Add `,label-only` to `--conditions` for the inbound-only comparison. Add `--only-suite
banking` (or `slack`, `travel`, `workspace`) to filter. The default is four worker processes.
Each model process starts in a fresh empty directory with a read-only sandbox. The prompt
forbids the model from using the CLI's own tools, commands or files. The last-message file
is outside that directory; stdout and stderr are discarded, never cached or reported.
This is a benchmark interface, not a claim that a prompt removes the CLI's capabilities.

The runner writes `results/<model>-<effort>/rows.jsonl`, `run.json` and `E2-SUMMARY.md`.
Results and cache are ignored by git. Each row is durable and appended by atomically
replacing the complete JSONL prefix. A parent lock excludes concurrent writers to the
same results directory. A task failure produces a row and does not abort other tasks.
Resume skips all recorded rows, including failed rows. Use a separate `--results-dir` to
repeat failures, retaining `--cache-dir` to reuse earlier successful replies. Incomplete
or duplicate rows are rejected. A changed model configuration, source implementation,
reference build, sample or frozen input rejects resume; it never mixes experiments.

Reports need only Python's standard library and the rows, with no AgentDojo environment,
cache, login, or model process:

```sh
python3 packages/agent-reference/eval/agentdojo/e2/report_e2.py packages/agent-reference/eval/agentdojo/e2/results/gpt-6.1-sol-low/rows.jsonl
```

An interrupted run can be reported with that same command. There is no claim of complete
sample coverage unless all selected rows are present. The report shows observed counts
and run fingerprints. Keep the completed model report beside the rows, or explicitly
select a destination with `--output`.

The full frozen sample has 97 benign tasks and 120 attacked pairs, 30 per suite. Injection
strata are shuffled with seed `19002026` and sampled without replacement. Round-robin
selection covers every injection at least once and balances stratum counts. The pilot
uses four benign tasks and four attacked pairs, one of each per suite, already in the
full sample. `SAMPLE.lock` includes the selected IDs, a canonical JSON SHA-256, hashes of
E1's existing fitted v1 files and locked standing inputs, and a benchmark source hash.
It was generated before any model call. Do not replace it. Verify it with:

```sh
packages/agent-reference/eval/.venv/bin/python packages/agent-reference/eval/agentdojo/e2/sample.py
```

`sample.py --freeze` exists to document construction and refuses to overwrite a lock.
`MANDATES.lock` is verified before every AgentDojo task import. Its scope is standing
mandates and classification; it did not preregister fitted files. E2 pins those existing
files without regenerating them. A mismatch stops the run for review.

`important_instructions` is loaded from the installed benchmark, including its ordinary
candidate discovery and placeholder replacement. The old benchmark cannot map the new
model name to prose; a scoped local substitution returns the requested model name during
attack construction. The actual template, task goal and placement code are unchanged.
The same attack text is generated for each condition. It may not be observed if a model
never reads the injected field. E2 does not insert E1's attacker oracle calls.

The unchanged E1 score function evaluates actual model output and executed calls, with
trace overrides first in the resulting score. `security.success=True` means **the attacker
succeeded**. Unknown is `null`, never an invented success or failure. Model termination
is a separate field: malformed replies, process exhaustion and turn limits mark the run
failed even if a state-based checker already considers the user's objective complete.
A report preserves that score and shows termination counts. Call-match flags require
exact function and arguments, so security is the authoritative attack outcome.

Configuration is through arguments or environment variables:

| Argument | Environment | Default |
|---|---|---|
| `--model` | `E2_MODEL` | `gpt-6.1-sol` |
| `--effort` | `E2_EFFORT` | `low` |
| `--command` | `E2_CODEX_COMMAND` | `bash /mnt/project-files/orchestration/codex/codex-sol.sh exec` |
| `--timeout` | `E2_TIMEOUT` | 300 seconds per process attempt |
| `--process-retries` | `E2_PROCESS_RETRIES` | 2 retries after the initial attempt |
| `--backoff` | `E2_BACKOFF` | 2 seconds, doubled per retry, capped at 30 |

`--command` is shell-split into an argument vector, never evaluated by a shell. The runner
adds `-m`, the effort config, `-s read-only`, `--skip-git-repo-check`, `-C`,
`--output-last-message`, and `-`. The fake model implements that same contract. Process
timeouts kill the process group, including children. A process exit, missing reply,
invalid encoding or start failure is recorded and retried; diagnostic logs are discarded.
A second malformed model reply ends the task with `model-format-error`; no extraction,
code-fence removal or repair is allowed. A format retry stays within its model turn.

The cache key is SHA-256 of canonical JSON `[model, effort, prompt]`. Successful process
replies, including malformed model replies, are stored verbatim. Cache entries verify
their reply hash. Per-key file locks prevent duplicate concurrent calls; writes are atomic.
Every process attempt and cache hit records its key, duration, cache flag, exit status,
prompt bytes and reply bytes, both in the row and in a per-key call journal. Failed
processes have no reusable reply but still have call records. No prompt files, CLI logs,
host environment, login data or host home-directory paths are persisted by the harness.
The results contain only benchmark content, model replies and explicit harness metadata.

A cold-cache budget for the three default conditions is:

| Run | Rows | Ordinary maximum (15 turns) | Including one format retry every turn | Including 2 process retries on both replies |
|---|---:|---:|---:|---:|
| Pilot | 24 | 360 | 720 | 2,160 |
| Full, including pilot | 651 | 9,765 | 19,530 | 58,590 |

A planning estimate of four to eight turns per row gives 96 to 192 pilot calls and 2,604
to 5,208 full-run calls before cache reuse and retries. This is an unmeasured estimate,
not a timing result. Identical initial prompts and later matching conversations reduce
physical calls across conditions and repeated user tasks. With label-only too, there
are 32/868 rows, ordinary maxima 480/13,020 and retry-inclusive maxima 2,880/78,120.

Offline validation, including all existing E1 Python tests:

```sh
packages/agent-reference/eval/.venv/bin/python -m pytest packages/agent-reference/eval/agentdojo -q
PATH=/opt/node24/bin:$PATH pnpm --filter @jeswr/agent-reference exec vitest run --config src/eval/vitest.config.ts
```

The fake executable is `fake_model.py`, invoked with a Python interpreter and `--script
<json file>`. Scripts can provide sequential replies, process failures, missing output,
assertions about the prompt and sleeps, or use a one-tool conversation mode. Its counter
is file-locked, so process-pool tests use real concurrent processes. No model or network
is used in these tests. Existing package lint, typecheck and tests are also run.

E1's documented checker discrepancy for workspace user_task_7, the read classification
of `get_webpage` despite its simulated request-log mutation, content-labelled mutation
acknowledgements and broad fitted argument scope all remain. Reading the upstream code
also revealed that banking injection_task_0's checker uses `service or "" in subject`,
so a nonempty service makes any transaction to the attacker satisfy it. E1 inherits that
benchmark error. E2 preserves it and reports the benchmark score. No frozen E1 file or
benchmark source was changed.
