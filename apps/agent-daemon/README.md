<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/app-agent-daemon

> Experimental — AI-agent-generated. Task instrumentation and offline statistics are implemented (A-045 / sst-v2c).

Host-neutral daemon composition for the agent layer (DESIGN §2.1 / §9.1).
The host loop and lifecycle commands remain reserved for their implementation task.
The `./testing` entry point is reserved.

## Export task statistics

```sh
pnpm exec turbo run build --filter=@jeswr/app-agent-daemon...
node apps/agent-daemon/bin/awp.mjs stats --ledger /private/runtime/ledger/events.jsonl
node apps/agent-daemon/bin/awp.mjs stats --ledger /private/runtime/ledger/events.jsonl --task paper-run-1 --format csv
```

The installed binary is `awp`. `stats` requires an explicit local ledger path,
including any sibling `.seg-<sequence>` archives retained by `FileLedger`.
It reads and verifies the evidence without appending, rotating, pruning or
contacting a provider. The default format is JSON; CSV has a stable header and
one row per task, sorted by task ID. A valid empty selection succeeds with no
task rows. Output goes to stdout; diagnostics go to stderr. Exit 0 means the
export succeeded; malformed arguments, invalid task labels, absent storage,
corrupt evidence or invalid counters exit 1 with scrubbed diagnostics.

`--ledger` is explicit because this app does not yet own runtime store discovery.
Pruned prefixes and entries without a task ID produce diagnostics; JSON carries
these limits and CSV repeats them per row. See
[`@jeswr/agent-audit`](../../packages/agent-audit/README.md#task-statistics-a-045)
for counter definitions, nearest-rank latency percentiles, tool-call linking,
approval-wait counting and integrity/completeness limits.

## Record a task

```ts
import { TaskRecorder } from '@jeswr/app-agent-daemon';

// writer is the runtime's existing AuditWriter, with its scoped pod mirror.
const task = new TaskRecorder({
  taskId: 'paper-run-1',
  conversation: 'urn:conversation:1',
  agent: 'https://pod.example/agent#me',
  owner: 'https://pod.example/profile#me',
}, writer);
await task.append({ type: 'conversation', id: 'urn:conversation:1' }, at);
await task.append({ type: 'proposal', id: 'urn:proposal:1' }, at);
await task.append({
  type: 'transmission', id: 'urn:transmission:1', proposal: 'urn:proposal:1', status: 'sent',
}, at);
```

Construct one recorder from trusted conversation context and retain its task ID
through proposals and transmissions. It snapshots and stamps that context on
every record; event data cannot override it. `task.modelCall(call, at)` accepts
the gateway's returned counters, including `GatewayError.calls`, and explicitly
projects allowed identifiers and counts. Record failures as well as successes.
For individual tool measurements use `task.append({ type: 'tool-call', id,
modelCall, tool, latencyMs, retries }, at)`; the producing `modelCall` link avoids
double-counting a gateway summary. Arguments, results and prompts are excluded.
Append the runtime's `confirm-required` decision when awaiting owner approval.

Await each append. Validation and mirror failures propagate exactly as with
`AuditWriter`; a failed mirror can leave durable local evidence, so retry its
mirror sync instead of repeating the append. This helper records observations;
the executor remains responsible for authorization, approvals and transmission.
New packages remain private per ADR-001 D5.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.
