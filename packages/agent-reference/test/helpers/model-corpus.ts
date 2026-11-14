// AUTHORED-BY Codex GPT-6
// Read-only test hooks capture exactly what real scenarios send, inspect and record.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync, readFileSync } from "fs";
import { vi } from "vitest";
import { digestOf } from "../../src/core/canonical.js";
import type { ActionIntent, Agreement, AnyMessage } from "../../src/core/types.js";
import { loadCase } from "../../src/engine/load.js";
import { matrixWorld } from "../../src/engine/matrix.js";
import { patch, runScenario } from "../../src/engine/run.js";
import type { Scenario } from "../../src/engine/schema.js";
import { copyData } from "../../src/model/copy.js";
import { AgentRuntime } from "../../src/runtime/agent.js";
import { MemoryLedger } from "../../src/store/ledger.js";
import * as packets from "../../src/trace/packet.js";

export interface Corpus {
  readonly messages: readonly { scenario: string; message: AnyMessage }[];
  readonly intents: readonly ActionIntent[];
  readonly agreements: readonly Agreement[];
  readonly packets: number;
  readonly paths: number;
  readonly coverage: { readonly expected: readonly string[]; readonly actual: readonly string[] };
}

/** Deterministic path sample: retain every original capacity path, then take the
 * first main-preferred path that adds a message kind or configuration. Retain
 * all forum-operation paths to preserve the six large intent occurrences too.
 * The live run must reproduce the complete recorded coverage, not just this plan.
 */
function samplePlan(root: string) {
  const manifest = JSON.parse(readFileSync(root + "scenario-runs.json", "utf8")) as {
    paths: { scenario: string; path: string; configuration?: string; trace?: string }[];
  };
  const capacity = JSON.parse(
    readFileSync(root + "test/fixtures/message-model-capacity.json", "utf8"),
  ) as {
    capacity: { type: string; field: string }[];
  };
  const messageIds = new Set(
    capacity.capacity.filter((item) => item.type.startsWith("Message/")).map((item) => item.field),
  );
  const operations = new Set(
    capacity.capacity.filter((item) => item.type === "ActionIntent").map((item) => item.field),
  );
  const requiredScenarios = new Map<string, boolean>();
  const rows = manifest.paths
    .filter((row) => row.trace)
    .map((row) => {
      const trace = JSON.parse(readFileSync(root + "traces/" + row.trace, "utf8"));
      const packets = trace.events.flatMap((event: { packet?: { id: string; kind: string } }) =>
        event.packet ? [event.packet] : [],
      ) as { id: string; kind: string }[];
      const tokens = new Set([
        "configuration:" + trace.configuration.id,
        ...packets.map((packet) => "kind:" + packet.kind),
      ]);
      if (row.configuration) tokens.add(`alternative:${row.scenario}/${row.configuration}`);
      if (!requiredScenarios.has(row.scenario)) {
        const { profile } = loadCase(root, row.scenario);
        requiredScenarios.set(
          row.scenario,
          profile.operations.some((operation) => operations.has(operation.id)),
        );
      }
      return {
        ...row,
        tokens,
        checks: new Set<string>(
          trace.events.flatMap((event: { check?: string }) => (event.check ? [event.check] : [])),
        ),
        required:
          requiredScenarios.get(row.scenario) ||
          packets.some((packet) => messageIds.has(row.scenario + "/" + packet.id)),
      };
    })
    .sort(
      (a, b) =>
        Number(a.path !== "main") - Number(b.path !== "main") ||
        a.scenario.localeCompare(b.scenario, "en") ||
        (a.configuration ?? "").localeCompare(b.configuration ?? "", "en") ||
        a.path.localeCompare(b.path, "en"),
    );
  const covered = new Set<string>();
  const groups = new Map<string, Set<string>>();
  const add = (row: (typeof rows)[number]) => {
    const key = row.scenario + "\0" + (row.configuration ?? "");
    let paths = groups.get(key);
    if (!paths) {
      paths = new Set();
      groups.set(key, paths);
    }
    paths.add(row.path);
    for (const token of row.tokens) covered.add(token);
  };
  for (const row of rows) if (row.required) add(row);
  for (const row of rows) if ([...row.tokens].some((token) => !covered.has(token))) add(row);
  // runScenario's stress coverage assertion remains enabled. Include witnesses
  // for every stress check required by the selected main/branch worlds.
  for (const [key, paths] of groups) {
    const [name, configuration] = key.split("\0");
    const { scenario } = loadCase(root, name!);
    const alternative = scenario.configurations.find((entry) => entry.id === configuration);
    const configured = alternative ? matrixWorld(scenario, alternative) : scenario;
    const candidates = rows.filter(
      (row) => row.scenario === name && (row.configuration ?? "") === configuration,
    );
    for (;;) {
      const required = new Set<string>(
        candidates.some((row) => row.path === "main") ? configured.stress : [],
      );
      for (const branch of configured.branches)
        if (paths.has(branch.id)) {
          for (const check of patch(configured, branch.change).stress) required.add(check);
        }
      const actual = new Set(
        candidates
          .filter((row) => row.path === "main" || paths.has(row.path))
          .flatMap((row) => [...row.checks]),
      );
      const missing = [...required].filter((check) => !actual.has(check));
      if (!missing.length) break;
      const witness = candidates.find(
        (row) => !paths.has(row.path) && missing.some((check) => row.checks.has(check)),
      );
      if (!witness)
        throw new Error(
          `Missing recorded stress witness: ${name}/${configuration}: ${missing.join(", ")}`,
        );
      add(witness);
    }
  }
  return {
    groups,
    messageIds,
    operations,
    expected: [...new Set(rows.flatMap((row) => [...row.tokens]))].sort(),
  };
}

/** One stable digest-ordered representative per model/configuration group, plus
 * every capacity object. FULL_CORPUS bypasses both stages of sampling.
 */
function representatives<T>(
  items: Map<string, T>,
  groupOf: (item: T) => string,
  retain: (item: T) => boolean,
): T[] {
  const groups = new Set<string>();
  return [...items]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .flatMap(([, item]) => {
      const group = groupOf(item);
      const include = retain(item) || !groups.has(group);
      groups.add(group);
      return include ? [item] : [];
    });
}

/** Materialize keyed world branch patches before selecting; otherwise omitted originals
 * become incomplete upserts instead of complete scenario branches. */
export function sampledScenario(
  scenario: Scenario,
  configuration: string | undefined,
  selected: ReadonlySet<string>,
): Scenario {
  const entry = scenario.configurations.find((candidate) => candidate.id === configuration);
  const branches = (entry ? matrixWorld(scenario, entry).branches : scenario.branches).filter(
    (branch) => selected.has(branch.id),
  );
  return {
    ...scenario,
    branches: scenario.branches.filter((branch) => selected.has(branch.id)),
    configurations: scenario.configurations.map((candidate) =>
      candidate === entry ? { ...candidate, world: { ...candidate.world, branches } } : candidate,
    ),
  };
}

export async function captureModelCorpus(): Promise<Corpus> {
  const root = new URL("../../", import.meta.url).pathname;
  const plan = samplePlan(root);
  const full = process.env.FULL_CORPUS === "1";
  const coverage = new Set<string>();
  const messages = new Map<string, { scenario: string; message: AnyMessage }>();
  const intents = new Map<string, ActionIntent>();
  const agreements = new Map<string, Agreement>();
  let current = "",
    count = 0,
    paths = 0;
  const packet = packets.packetView;
  const packetSpy = vi.spyOn(packets, "packetView").mockImplementation((...args) => {
    // Only the captured plain model belongs to this corpus, not old runtime graphs
    // retained by Vitest's call/context/result history across a large matrix cell.
    packetSpy.mockClear();
    count++;
    messages.set(digestOf(args[0]), { scenario: current, message: copyData(args[0]) });
    return packet(...args);
  });
  const proto = AgentRuntime.prototype as unknown as {
    authorise(intent: ActionIntent, quiet?: boolean): unknown;
  };
  const authorise = proto.authorise;
  const authSpy = vi.spyOn(proto, "authorise").mockImplementation(function (
    this: typeof proto,
    intent,
    quiet,
  ) {
    authSpy.mockClear();
    intents.set(digestOf(intent), copyData(intent));
    return authorise.call(this, intent, quiet);
  });
  const append = MemoryLedger.prototype.append;
  const ledgerSpy = vi.spyOn(MemoryLedger.prototype, "append").mockImplementation(function (
    this: MemoryLedger,
    record,
    at,
  ) {
    ledgerSpy.mockClear();
    if (record.type === "agreement") {
      const agreement = record as Agreement;
      agreements.set(digestOf(agreement), copyData(agreement));
    }
    return append.call(this, record, at);
  });
  try {
    for (const file of readdirSync(root + "scenarios")
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      current = file.slice(0, -5);
      const { profile, scenario } = loadCase(root, current);
      for (const configuration of [
        undefined,
        ...scenario.configurations.map((entry) => entry.id),
      ]) {
        const selected = plan.groups.get(current + "\0" + (configuration ?? ""));
        if (!full && !selected) continue;
        const input = full ? scenario : sampledScenario(scenario, configuration, selected!);
        const results = await runScenario(profile, input, { configuration });
        paths += results.filter((result) => result.trace).length;
        for (const result of results)
          if (result.trace) {
            coverage.add("configuration:" + result.trace.configuration.id);
            if (configuration) coverage.add(`alternative:${current}/${configuration}`);
            for (const event of result.trace.events)
              if (event.packet) coverage.add("kind:" + event.packet.kind);
          }
      }
      // Vitest otherwise retains every historical agent and ledger in mock contexts.
      packetSpy.mockClear();
      authSpy.mockClear();
      ledgerSpy.mockClear();
    }
  } finally {
    packetSpy.mockRestore();
    authSpy.mockRestore();
    ledgerSpy.mockRestore();
  }
  return {
    messages: full
      ? [...messages.values()]
      : representatives(
          messages,
          (item) => item.message.configuration + "\0" + item.message.kind,
          (item) => plan.messageIds.has(item.scenario + "/" + item.message.id),
        ),
    intents: full
      ? [...intents.values()]
      : representatives(
          intents,
          (intent) => intent.operation + "\0" + intent.action,
          (intent) => plan.operations.has(intent.operation),
        ),
    agreements: [...agreements.values()],
    packets: count,
    paths,
    coverage: { expected: plan.expected, actual: [...coverage].sort() },
  };
}
