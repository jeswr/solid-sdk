// AUTHORED-BY Codex GPT-6
// Read-only test hooks capture exactly what real scenarios send, inspect and record.
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { readdirSync } from "fs";
import { vi } from "vitest";
import { digestOf } from "../../src/core/canonical.js";
import type { ActionIntent, Agreement, AnyMessage } from "../../src/core/types.js";
import { loadCase } from "../../src/engine/load.js";
import { runScenario } from "../../src/engine/run.js";
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
}
export async function captureModelCorpus(): Promise<Corpus> {
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
  const root = new URL("../../", import.meta.url).pathname;
  try {
    for (const file of readdirSync(root + "scenarios")
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      current = file.slice(0, -5);
      const { profile, scenario } = loadCase(root, current);
      const results = await runScenario(profile, scenario, { configuration: "all" });
      paths += results.filter((result) => result.trace).length;
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
    messages: [...messages.values()],
    intents: [...intents.values()],
    agreements: [...agreements.values()],
    packets: count,
    paths,
  };
}
