<!-- AUTHORED-BY Codex GPT-6 -->
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
SSH forwards binding 127.0.0.1. The admin profile starts at `/admin` (`startPath`); its environment base can stay at the origin. The executor permits
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

`profile` calls `profileSite` with that site's base URL (or its optional `startPath`), login,
page bound and verification. `profileTimeoutMs` defaults to 180000 and bounds the whole profile;
`maxPages` defaults to 40 attempted pages. `startPath` resolves on the configured origin and
cannot leave the site. Environment URLs used by the evaluator retain `baseUrl`.
Its crawl/probes/verification are read-only; the profiler blocks non-GET requests outside
login and declared demonstrations. Models go to `models/<site>.ttl`, with a companion
`<site>.profile.json` recording warnings and demonstration names/digest. Failed login or
an undemonstrated non-login write prevents saving. No benchmark task is loaded by `profile`.

Writes require **generic per-site demonstrations recorded once**, independently of task
selection. A test-support UI demonstration for the disposable admin fixture and opt-in write acceptance are described below. Other sites require their own authorized recordings. Record interactions through the normal UI, using disposable data, then
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
the unrelated evaluator stack; no parsing/evaluation algorithm is replaced. Full Python scoring needs the pinned evaluator environment and reachable applications.
It is separate from the opt-in local profiling/executor acceptance below; that acceptance
invokes no evaluator or planner and establishes no benchmark score.

## Opt-in local live acceptance (no planner)

With the disposable public benchmark admin fixture at 127.0.0.1:7780, an ignored config can use:

```json
{
  "dataset": "test/fixtures/dataset.json",
  "modelsDir": "models",
  "maxPages": 16,
  "profileTimeoutMs": 180000,
  "sites": {
    "shopping_admin": { "baseUrl": "http://127.0.0.1:7780", "startPath": "/admin",
      "login": { "username": "admin", "password": "admin1234" } },
    "shopping": { "baseUrl": "http://127.0.0.1:7770", "login": null },
    "reddit": { "baseUrl": "http://127.0.0.1:9999", "login": null },
    "gitlab": { "baseUrl": "http://127.0.0.1:8023", "login": null }
  }
}
```

The dataset is unused by `profile`; the example points at a fictional fixture. Real benchmarking
still needs the reference dataset and provisioned accounts. Run only these commands for read
acceptance:

```sh
node tools/webarena-bench/dist/cli.js profile --site shopping_admin
SAB_LIVE_SITE_URL=http://127.0.0.1:7780/admin \
  SAB_LIVE_OUTPUT_DIR=/tmp/sab-live \
  pnpm -w exec vitest run --root tools/webarena-bench test/live.test.ts
```

The test is skipped unless `SAB_LIVE_SITE_URL` is set. `SAB_LIVE_USERNAME` and
`SAB_LIVE_PASSWORD` override the public fixture account; `SAB_LIVE_OUTPUT_DIR` optionally saves
the learned model/profile and three Turtle observations. It signs in, profiles at most 16 pages
under a three-minute profile deadline, requires verified signed-in list/search reads for orders,
customers and products, checks refusal without a session, then logs in afresh through the learned
LoginRoute. It prints RDF for customer names containing Emma, the five most recent orders with
totals/statuses and a product-name search. Only sign-in may POST. No task intent, reference answer,
planner CLI, mutating demonstration or evaluator is invoked. Endpoint names exist only in the
opt-in test assertions; profiler/executor source remains site-generic.

A MUTATE run first needs a recorded UI demonstration creating or editing a disposable catalogue
item and restoring it, including the real save request, hidden anti-forgery fields and response
identities. Restore the container snapshot after recording. Learn writes from that demonstration
and retain per-write executor approvals; never infer save endpoints from task answers. The live
read test does not establish mutation coverage or a benchmark score.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Opt-in disposable write acceptance

`test/support/admin-product.ts` is a UI demonstration for the local Magento fixture, outside
production source. It creates `SAB Test Widget <random>` with unique SKU, price 12.34 and
quantity 5, witnesses a read-only grid filtered by its newly assigned ID, changes the price
to 23.45, then deletes its verified row through the grid action. The profiler returns the
learned identity read-back in `writeResponses` for script-rendered create landings.
It blocks background preference/bookmark writes. Cleanup requires exactly one complete match
and checks the response's name, exact SKU and created ID before selecting its checkbox,
including when saved columns hide those fields.

```sh
SAB_LIVE_SITE_URL=http://127.0.0.1:7780/admin \
  SAB_LIVE_OUTPUT_DIR=/tmp/sab-live \
  pnpm -w exec vitest run --root tools/webarena-bench test/live-writes.test.ts
```

The switch and credential overrides match the existing read test. The test learns with
`profileSite({ demonstrations })`, round-trips the actual model, logs in afresh, and runs
`createTaskExecutor`/`runTask` with a scripted planner and recorded approvals. Each action is
first denied (zero additional traffic after the prompt), then approved. The test also creates
a similarly named neighbour with a distinct SKU. A broad name search matching both refuses
before write approval. The delete Flow resolves the intended SKU and names that product in
its approval, re-resolves on retry, deletes it, then confirms the neighbour still exists.
The opt-in fixture configures a resolver whose concrete query scope equals the witnessed delete
form, rather than exempting grid transport defaults. It forwards the profiler's demonstration-learned
`writeResponses` beside the RDF model. The delete redirect uses its learned completionOnly
policy and emits Completed without a created identity. Subsequent complete grid reads verify
deletion and the surviving neighbour. The resolver scope adaptation belongs only to the opt-in test. Production profiling retains
its learned model and stores response policies in the profile JSON sidecar.
Exactly two create POSTs, one update POST and one delete POST are required; an identical
repeated create is blocked within the task. Grid reads check both prices and disappearance.
Browser cleanup covers both products after execution, including failure, using only the test's
session and verified own items. Optional artifacts stay
outside the repository. No LLM/planner CLI, benchmark task, evaluator or real catalogue fixture
is used. The profile has a four-minute deadline; the whole live write test has six minutes.

Counts, endpoint noun types and typed row display values are covered by package unit tests.
The existing `test/live.test.ts` remains a separate read acceptance. The sandbox must retain
127.0.0.1 in generated URLs; a localhost redirect is a stop condition. Script-only CSRF sources
and uploaded/oversized forms cannot be replay-learned with the current contract and bounds.

On this sandbox the admin request sent only the admin session cookie, so learned form_key
rules use the witnessed hidden input. Cookie sources still take precedence when observed.
The grid deletion submits `excluded=false` with the unique-SKU search rather than selected IDs;
that search is required and dynamic in the learned DeleteAction. Generic script-only CSRF sources
are reported and excluded instead of inventing a new contract source kind.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Opt-in disposable HTML forum acceptance

```sh
SAB_LIVE_FORUM_URL=http://127.0.0.1:9999 \
  SAB_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome \
  pnpm -w exec vitest run --root tools/webarena-bench test/live-forum.test.ts
```

This separate switch targets the disposable WebArena Postmill fixture and verifies the sandbox
account MarvelsGrantMan136 / test1234. Two read-only seed profiles (a thread and a sorted forum)
cover the read acceptance without demonstrations: forum lists,
sorted/paged posts, comments, search and a profile replay as typed RDF, with user text untrusted.
The UI recording in test/support/forum.ts creates its own random SAB test post and comment,
edits/votes, then deletes both. It records native HTML votes and omits the unused upload control.
The executor acceptance learns and RDF-round-trips that actual model, signs in afresh through
its cookie-check route, and uses a scripted planner. Each of six writes is first denied, then
approved; all twelve summaries are recorded. Reads verify changes/deletion, and repeating the
same comment in the task sends nothing. Cleanup checks the random title and author before
removing the test post, including failure recovery. No model CLI, evaluator, API documentation
or benchmark task is used; no site-specific constants are added to production source.

The create request obtains its forum ID from an earlier learned options read. New post/comment
identities come from executor receipts. Forum verification uses the learned exclusive ID cursor,
so imports whose existing IDs exceed the fresh sequence still show the created item. Optional
SAB_LIVE_OUTPUT_DIR stores a compact forum-acceptance.json with operations and approval summaries.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Live fixtures pass the profiler's learned `writeResponses` to the executor. They declare no
created-location patterns. The benchmark profile JSON sidecar stores the same policy map;
execution loads it beside the TTL model. Without that artifact, redirected writes retain
Uncertain outcomes under the executor's existing rules.

The opt-in admin live files run serially because they share the sandbox account and its
authentication state; ordinary unit tests retain file parallelism.
