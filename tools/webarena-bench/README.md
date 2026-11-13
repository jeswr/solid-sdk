<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/webarena-bench

Private Node 24 benchmark harness for the semantic agent browser and **WebArena-Verified
1.2.3**. The TypeScript process reads the dataset JSON; Python owns evaluation. No Python
module is imported into TypeScript. Models, local credentials and default run artifacts
are gitignored. Nothing here needs a new registry dependency: `n3` and its types already
exist in the workspace lockfile.

The planner sees the task intent, action catalogue, observed starting-page identities and
bounded RDF history. It never receives HTML, raw HTTP, credentials, API documentation,
evaluation schemas or expected answers. Task-type metadata is read once and discarded with
the other evaluation fields. The host appends an answer-format instruction to the catalogue;
`runTask`'s goal remains the task intent. Each run uses the existing executor approval gate;
the host approves every requested benchmark action and records every decision.

## Run on the maintainer's Mac

From the workspace root, with Node 24, pnpm and logged-in `claude` or the existing
`codex-sol.sh` wrapper on PATH:

```sh
pnpm install --filter '@jeswr/webarena-bench...' --frozen-lockfile --ignore-scripts
pnpm --filter '@jeswr/webarena-bench...' run build
cp tools/webarena-bench/bench.config.example.json tools/webarena-bench/bench.config.json
python3 -m venv /tmp/webarena-bench-venv
/tmp/webarena-bench-venv/bin/pip install 'webarena-verified==1.2.3'
```

Set `dataset` in the copied config to the installed package's
`webarena_verified/assets/dataset/webarena-verified.json`, or retain the path to the local
reference copy. Paths in config resolve relative to the config file. The reference copy
is ignored and must never be committed.

The example ports come from the reference's `environments/container/config.py`: shopping
7770, shopping_admin 7780, reddit 9999 and gitlab 8023. Edit these for the VM or use Mac
SSH forwards binding 127.0.0.1. The admin base includes `/admin`. The executor permits
HTTPS or loopback HTTP, so a plain HTTP VM address needs a loopback forward or HTTPS.
The VM applications must generate links/redirects using those same accessible origins;
forwarding a port alone does not rewrite server-generated absolute URLs.

Supply the eight `WA_<SITE>_USERNAME` / `WA_<SITE>_PASSWORD` environment variables named
in the example, or put `login: { "username": "...", "password": "..." }` in the ignored
config. The 1.2.3 wheel contains **no complete default login-account table**: its metadata
only gives a GitLab `root` / `demopass` example, not a guaranteed environment default.
Use the accounts provisioned on the VM. An explicit `login: null` permits anonymous
profiling/running; omitted or empty credentials fail config validation. All four sites
must have valid config entries, even when a command selects one site.

Install Playwright Chromium on the Mac using the workspace's existing Playwright install,
or set `SAB_CHROMIUM_PATH` to an existing Chromium executable. Then:

```sh
pnpm --filter @jeswr/webarena-bench run webarena-bench -- profile --site shopping_admin
pnpm --filter @jeswr/webarena-bench run webarena-bench -- run --site shopping_admin --tasks 0 --planner claude --model sonnet --out /tmp/webarena-admin-claude
pnpm --filter @jeswr/webarena-bench run webarena-bench -- evaluate --out /tmp/webarena-admin-claude --python /tmp/webarena-bench-venv/bin/python
```

Use `--planner codex --model <model-name>` for Codex. Omit `--tasks` to run the site's
whole available cohort; use comma-separated IDs to select tasks. An alternative config
can be selected with `--config /absolute/path/bench.config.json`. The compiled bin also
works as `node tools/webarena-bench/dist/cli.js ...` (omit pnpm's `--` separator).
`--max-steps` and `--timeout-ms` override the config's per-task limits (30 planner calls
and 300000 ms by default). The time budget covers login, start-page GETs, planning,
execution and the final navigation GET. Requests use a task AbortSignal, so a late planner
continuation cannot perform another write. Each CLI invocation gets at most half the
remaining time to accommodate its existing one-retry policy.

Every task gets a fresh session provider and login. **Application state is not reset by
this harness.** Restore the benchmark VM snapshot before each independent task attempt,
and after demonstrations. For comparable isolated scores, run a single ID per reset into
the same output root, then evaluate that root. Batch mode is sequential and can otherwise
carry application mutations between tasks. Existing task directories are refused, so use
a new output root for a repeat/model comparison.

## Profile once; demonstrations are site-generic

`profile` calls `profileSite` with that site's base URL, login, page bound and verification.
Its crawl/probes/verification are read-only; the profiler blocks non-GET requests outside
login and declared demonstrations. Models go to `models/<site>.ttl`, with a companion
`<site>.profile.json` recording warnings and demonstration names/digest. Failed login or
an undemonstrated non-login write prevents saving. No benchmark task is loaded by `profile`.

Writes require **generic per-site demonstrations recorded once**, independently of task
selection. No live recordings are bundled: this implementation environment cannot reach
the VM. Until a recording is supplied, the learned model supports its discovered reads
and login only. Record interactions through the normal UI, using disposable data, then
encode the selectors/values in a JSON recording and set that site's `demonstrations` config
path. Never derive recordings from a task intent, expected result, evaluator rule or API doc.

| Site | Example generic demonstration scope |
| --- | --- |
| shopping | Search/view an arbitrary product; add/remove it from the basket. |
| shopping_admin | Create/edit a disposable catalogue entry, then restore it. |
| reddit | Create/edit/delete a disposable sandbox post or comment. |
| gitlab | Create/edit/close a disposable issue in a scratch project. |

These are operation families, not scripts or task answers. Actual selectors must come
from the site's UI recording. A recording for the fictional test-shop would look like:

```json
{
  "x-authored-by": "Claude Opus 5.5",
  "site": "shopping",
  "scope": "site-generic",
  "demonstrations": [{
    "name": "search-products",
    "description": "Use the site's ordinary search UI",
    "steps": [
      {"action": "goto", "path": "/"},
      {"action": "fill", "selector": "#q", "value": "example"},
      {"action": "press", "selector": "#q", "value": "Enter"},
      {"action": "waitForURL", "path": "/search?q=example"}
    ]
  }]
}
```

Supported steps: `goto`/`waitForURL` (`path`), `click` (`selector`), and
`fill`/`select`/`press` (`selector`, `value`). Each action auto-waits as Playwright normally
does; add `waitForURL` after navigation and before the next action. Paths can be absolute
on-site URLs, root paths, or relative paths under the configured base. Credentials stay
in config, not recordings. The model manifest hashes the recording so a later run can
identify the learning input. It does not certify human independence from task answers.

## Tasks, answers and submission files

All tasks using the selected site are considered. Any task needing wikipedia, map or
another unsupported site is skipped, including multi-site tasks. Unknown requested IDs
are errors. URL placeholders in both intents and start URLs use the configured site
bases; `/admin` is preserved. Supported multi-site tasks load and log into every involved
site model. An observed object/url/target IRI routes an action to its origin; otherwise
exactly one site must have a matching plan. Identical action signatures across sites
remain ambiguous instead of selecting a site arbitrarily. Profile every involved site
first. Avoid running a shared multi-site task twice when combining per-site cohorts.

```text
<out>/
  <task_id>/
    agent_response.json   # exact FinalAgentResponse field names
    network.har           # actual executor/login/navigation transport traffic
    run_config.json       # original dataset path + environment URLs, no credentials
    metrics.json          # steps, prompt-token estimate, whole-task wall time, outcome
    approvals.json        # every host auto-approval, including its executor-issued ID
    agent_trace.json      # runTask's redacted trace, when runTask reached completion
  selection.json          # CLI-selected task IDs and skip reasons
  summary.json            # generated by evaluate, plus per-task evaluator statuses
  summary.md              # per-site/type totals, rates, mean steps/tokens/wall time
```

`agent_response.json` has `task_type`, `status`, `retrieved_data` and `error_details`.
RETRIEVE keeps typed homogeneous result arrays, including objects with the requested keys.
A bare JSON primitive/object is a one-item result; plain text is a one-string fallback.
MUTATE and NAVIGATE use null `retrieved_data`. An explicit status envelope supplies error
categories; clarification, exhaustion, timeouts and setup failures become `UNKNOWN_ERROR`.
A success claim after an incomplete mutation is rejected. No expected answer/status is
used to decide success. NAVIGATE additionally requires `final_url` in the agent answer
(or a bare URL); the host GETs it through the executor and follows guarded redirects, with
`Accept: text/html`, so the last HAR event is the real identified page navigation.

The Python command is `python -m webarena_verified eval-tasks --output-dir <out>`.
It discovers numeric task directories and reads each `run_config.json`. It produces
`<task_id>/eval_result.json`. The harness then aggregates those files. Python can exit 0
despite per-task evaluation errors; missing/invalid results count as errors and remain in
the denominator. Old result files are removed before evaluation. Reports are written even
when the Python process fails. Multi-site tasks count in every involved site's row; ALL
counts each task once. Token counts are `ceil(prompt characters / 4)`, including the answer
format/start-page context, **estimates rather than provider usage**.

## HAR contract and redaction

The wrapper records the actual method, URL, headers, postData (`mimeType`, `text`), status,
response content (`mimeType`, `text`), response cookies and `redirectURL` under
`log.entries[].request/response`. This matches `NetworkTrace`/`NetworkEvent` in 1.2.3.
Bodies are captured from cloned responses without altering what the executor receives.
The 5 MiB response-body bound fails explicitly, with `_capture_error`, rather than silently
truncating evidence. Failed transport attempts have status 0; no synthetic successful event
is inserted. No-HTTP setup failures produce an empty HAR, which the reference rejects.

Only the saved HAR copy is redacted: authorization/CSRF headers; session cookie values;
password, token and CSRF fields in JSON, forms, multipart, URLs and HTML input/meta fields.
Known password/session/header secrets of at least eight characters are also removed from
echoed string values. Short values are removed structurally rather than globally replacing
common characters. Unrecognized secrets in arbitrary site text are not guaranteed to be
detected. Files/directories are created with 0600/0700 permissions.

**`mage-messages` cookie values are preserved**: five shopping wishlist evaluators match
their message text. All other cookie values are redacted, while names remain. The dataset's
four Cookie-header assertions are map-only tasks, which this harness skips. No selected
evaluator expects credential/CSRF post fields. Referer, semantic form/JSON fields and JSON
response data remain available because the evaluator uses them. HTML and other task data
are host-side artifacts and must never be forwarded to the planner.

The evaluator checks concrete HTTP evidence, not semantic equivalence of operations.
An equivalent action using a different endpoint, request shape, Referer, cookie message or
navigation sequence may fail. The generic profiler's current extraction/labelling and
ambiguous models will not cover every WebArena workflow. The harness does not patch models
with task-specific endpoints, use hidden APIs or bypass executor safety refusals.

## Local validation

```sh
pnpm --filter @jeswr/webarena-bench run lint
pnpm --filter @jeswr/webarena-bench run build
pnpm --filter @jeswr/webarena-bench run typecheck
pnpm --filter @jeswr/webarena-bench run test
pnpm run lint:root
```

Tests cover filtering/substitution, config, every task type/status, HAR contract/redaction,
deadlines, profile/demonstration seams and summary aggregation. The mini end-to-end runs
the **real `tools/test-shop` route handlers** with an in-memory HTTP socket adapter, a fixed
site-generic model fixture and scripted planners; it checks login, two approvals, writes,
navigation and the submission directory. It requires neither Chromium nor a listener.
The Python process boundary is scripted for summary tests; those tests are not benchmark
success measurements.

`test/reference.test.ts` separately exercises the reference's actual FinalAgentResponse,
NetworkTrace and NetworkEvent implementations against generated fixtures. It needs the
local reference at the workspace root plus Python 3/pydantic. Its small Python loader
resolves only the public-types/parser import cycle, avoiding package initialization of
the unrelated evaluator stack; no parsing/evaluation algorithm is replaced. The complete
Python evaluator could not start in this offline build environment because `jsonpath_ng`
is absent. Full scoring and live profiling must be validated on the Mac with the pinned
Python installation and reachable VM.
