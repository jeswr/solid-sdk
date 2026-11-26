// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import {
  AuditWriter,
  auditArtifact,
  FileLedger,
  MemoryLedger,
  PodMirror,
} from "@jeswr/agent-audit";
import { seal } from "@jeswr/agent-audit/verify";
import {
  type BridgeMessage,
  ChannelParseError,
  DIRECT,
  encodeEnvelope,
  encodeEnvelopeObject,
  type InboundRawMessage,
  readEnvelope,
} from "@jeswr/agent-channels";
import { createDirectReader } from "@jeswr/agent-channels/direct";
import { inspectEmail } from "@jeswr/agent-channels/email-mime";
import { createGraphTeamsReader } from "@jeswr/agent-channels/graph-teams";
import { parseMatrixMessage } from "@jeswr/agent-channels/matrix";
import { RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import {
  type ApprovalContext,
  createExecutor,
  type OutboxEntry,
  ProposalRefusedError,
  proposalApprovalTerms,
  proposalTermsDigest,
} from "@jeswr/agent-executor";
import { createMemoryStores } from "@jeswr/agent-executor/testing";
import {
  defaultMandate,
  issueApproval,
  issueMandate,
  mandateToTurtle,
  solidOdrlEngine,
  verifyApproval,
} from "@jeswr/agent-mandate";
import {
  canonicalJson,
  digestBytes,
  digestOf,
  newUrn,
  recordFromTurtle,
  recordToTurtle,
} from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { createGateway, GatewayError, type ModelCall } from "@jeswr/agent-model-gateway";
import { fakeFetch } from "@jeswr/agent-model-gateway/testing";
import {
  AgentRuntime,
  CONFIG_ED25519,
  FileStateStore,
  introduce,
  PILOT_PROFILE,
  FileLedger as ReferenceLedger,
} from "@jeswr/agent-reference";
import type { JsonObject } from "@jeswr/agent-reference/core/types";
import { evaluateRule, ruleSchema } from "@jeswr/agent-reference/derive/rules";
import { GateMemory } from "@jeswr/agent-reference/gates/common";
import { testKey } from "@jeswr/agent-reference/reference/keys";
import { Cast, craftSigned, mandateOf, signClaim } from "@jeswr/agent-reference/scenarios/common";
import { addSourceRule, pinIssuer, saveTrust } from "@jeswr/agent-reference/setup";
import { readLedgerSegment } from "@jeswr/agent-reference/store/ledger";
import { readRuntimeStateFile } from "@jeswr/agent-reference/store/state";
import { carriageBytes } from "@jeswr/agent-reference/wire/carriage";
import { parseEmail } from "@jeswr/agentic-legacy-bridge";
import { DEFAULT_CONNECTOR_RUN_TIMEOUT_MS } from "@jeswr/pod-connectors";
import type { ChangeEvent, NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import {
  buildBitstringStatusListCredential,
  createWebIdKeyResolver,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
import { copyFile, mkdtemp, rm, writeFile } from "fs/promises";
import { Server } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import { event } from "../../../packages/agent-channels/test/fixtures/matrix.js";
import * as teams from "../../../packages/agent-channels/test/fixtures/teams.js";
import { createCliHost, runCli } from "../src/cli.js";
import { createDaemon, pollInterval } from "../src/daemon.js";
import { createInboundGate, openGate, readGate } from "../src/gate.js";
import { initGate } from "../src/gate-setup.js";
import { createLocalState } from "../src/local.js";
import { createRuntimeMemory } from "../src/memory.js";
import {
  createMemoryPod,
  createMemoryState,
  createTestGate,
  createTestMemory,
} from "../src/testing.js";
import type { DaemonOptions } from "../src/types.js";
import { PodWorkspace } from "../src/workspace.js";
import { testRecordPort } from "./record-port.js";

export const ROOT = "https://pod.example/";
export const OWNER = `${ROOT}profile/card#me`;
export const AGENT_ID = `${ROOT}profile/agent#me`;
export const AT = Date.parse("2026-11-01T12:00:00.000Z");
function harness() {
  const pod = createMemoryPod();
  const workspace = new PodWorkspace({
    io: pod.io,
    storage: pod.storage,
    root: ROOT,
    ownerWebId: OWNER,
    privateTypeIndex: `${ROOT}settings/privateTypeIndex.ttl`,
  });
  const state = createMemoryState();
  const ledger = new MemoryLedger();
  const changes: ((change: ChangeEvent) => void)[] = [];
  const resyncs: (() => void)[] = [];
  const subscription: Subscription = {
    topics: [],
    state: "live",
    channel: "websocket",
    on: vi.fn((event: string, handler: (value: ChangeEvent) => void) => {
      if (event === "change") changes.push(handler);
      if (event === "resync") resyncs.push(handler as () => void);
      return vi.fn();
    }) as unknown as Subscription["on"],
    close: vi.fn(async () => undefined),
    async *[Symbol.asyncIterator]() {},
  };
  const notifications: NotificationsClient = {
    subscribe: vi.fn(async () => subscription),
    plan: () => ({ channel: "websocket", reason: "fixture" }),
  };
  const executor = {
    status: vi.fn(async () => "running" as const),
    runOutboxOnce: vi.fn(async () => ({})),
    onControlOrMandateChange: vi.fn(async () => ({})),
    onApprovalChange: vi.fn(async () => ({})),
    transmit: vi.fn(),
    drain: vi.fn(async (): Promise<void> => undefined),
  };
  const text = "Can you reply today?";
  const message: BridgeMessage = {
    channel: "direct",
    textBody: text,
    signals: {},
    rawSha256: digestBytes(text).slice(8),
    rawByteLength: Buffer.byteLength(text),
    rawMediaType: "text/plain",
    warnings: [],
    messageId: "seed",
    jsonLdBlocks: [
      JSON.stringify({
        "@context": { agent: "https://jeswr.org/ns/agent#" },
        "@type": "agent:SignedMessage",
        "agent:wireFormat": "jws-compact",
        "agent:compactJws": "fixture.signed.envelope",
      }),
    ],
  };
  const ingest = {
    list: vi.fn(async (_account: { id: string }, _cursor?: string, _limits?: unknown) => ({
      items: [{ id: "seed", raw: text }],
      next: "one",
    })),
    parse: vi.fn((_item: InboundRawMessage) => message),
  };
  const reader = createGateway({
    provider: "openai",
    model: "fixture",
    maxTokens: 100,
    tokens: {
      read: vi.fn(async () => {
        throw new Error("No provider access in tests");
      }),
    },
    account: "fixture",
  }).reader;
  const render = (proposal: OutboxEntry["proposal"]): OutboxEntry["renderable"] => ({
    compactJws: "fixture.signed.carrier",
    message: {
      profile: "urn:profile:fixture",
      configuration: "urn:config:fixture",
      id: "urn:message:fixture",
      conversation: proposal.intent.conversation,
      kind: "invoke",
      from: { actor: AGENT_ID },
      createdAt: new Date(AT).toISOString(),
      expiresAt: "2026-11-02T12:00:00.000Z",
      body: {
        operation: { id: proposal.intent.operation, version: "1" },
        input: {},
        basis: { kind: "public" },
      },
    },
  });
  const options: DaemonOptions = {
    gate: {
      ...testRecordPort(AGENT_ID, OWNER),
      async release(proposal) {
        return { ok: true, renderable: render(proposal), preview: "Fixture preview" };
      },
      async check({ message }) {
        const digest = `sha-256:${message.rawSha256}`;
        try {
          readEnvelope(message.jsonLdBlocks?.[0] ?? "");
          return { outcome: "admitted", digest };
        } catch {
          return { outcome: "unstructured", digest };
        }
      },
    },
    workspace,
    notifications,
    executor,
    lease: state.lease,
    checkpoints: state.checkpoints,
    proposalResults: state.proposalResults,
    accounts: [
      { id: "fixture", binding: { id: "direct", ingest }, category: "chat", enabled: true },
    ],
    ownerWebId: OWNER,
    agentWebId: AGENT_ID,
    audit: {
      append: async (r, at) => ledger.append(r, at),
      entries: () => ledger.entries(),
      sync: async () => undefined,
    },
    project: async (proposal, sign) => {
      const released = await sign();
      if (!released.ok) throw new ProposalRefusedError(released.reason);
      const { renderable } = released;
      const bytes = canonicalJson(renderable);
      const wire = { bytes, digest: digestBytes(bytes), mediaType: "application/json" };
      const entry: OutboxEntry = {
        proposal: {
          ...proposal,
          renderedPreview: wire.bytes,
          intent: {
            ...proposal.intent,
            action: "https://jeswr.org/ns/agent#SendMessage",
            recipientHash: `sha256:${"a".repeat(64)}`,
          },
        },
        renderable,
        account: { id: "fixture" },
        wire,
        wireDigest: wire.digest,
      };
      entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
      return entry;
    },
    gateway: {
      reader,
      proposer: {
        propose: vi.fn(async (conversation) => ({
          proposals: [
            {
              ...exampleRecords["action-proposal"],
              id: `urn:proposal:${digestOf(conversation).slice(8)}`,
            },
          ],
          calls: [],
        })),
      },
    },
    memory: createTestMemory(),
    proposerContext: {
      pod: {
        root: ROOT,
        webId: OWNER,
        read: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
      instructions: "Synthetic fixture",
    },
    isFlagged: vi.fn(async () => false),
    now: () => AT,
  };
  return {
    pod,
    workspace,
    release: (proposal: OutboxEntry["proposal"]) =>
      ({ ok: true, renderable: render(proposal), preview: "Fixture preview" }) as const,
    state,
    ledger,
    options,
    executor,
    ingest,
    message,
    notifications,
    subscription,
    changes,
    resyncs,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const measuredCall = (context: ModelCall["context"], id = context): ModelCall => ({
  id: `urn:model-call:${id}`,
  context,
  provider: "openai",
  model: "fixture",
  tokens: { input: 7, output: 3 },
  inputTokens: 7,
  outputTokens: 3,
  toolCalls: 1,
  latencyMs: 2.4,
  retries: 1,
});

it.each([
  0, 1, 2,
])("awp stats includes a flagged runtime task with Reader and Proposer calls for %i proposals", async (count) => {
  const h = harness();
  Object.assign(h.message, { jsonLdBlocks: [] });
  vi.mocked(h.options.isFlagged).mockResolvedValue(true);
  const reader = measuredCall("reader");
  const proposer = measuredCall("proposer");
  vi.spyOn(h.options.gateway.reader, "extract").mockImplementation(async (_message, schema) => ({
    data: schema.parse({ primary: "needs_reply", urgency: "not_urgent", confidence: 1 }),
    calls: [{ ...reader, taskId: "model-task", conversation: "urn:model-conversation" }],
  }));
  vi.mocked(h.options.gateway.proposer.propose).mockResolvedValue({
    calls: [proposer],
    proposals: Array.from({ length: count }, (_, i) => ({
      ...exampleRecords["action-proposal"],
      id: `urn:proposal:model-${i}`,
    })),
  });
  const daemon = createDaemon(h.options);
  await daemon.once();
  const records = h.ledger
    .entries()
    .map((e) => e.record)
    .filter(
      (r) =>
        r.type !== "ledger-checkpoint" && r.type !== "gate-decision" && r.type !== "record-anchor",
    );
  const taskId = records[0]?.taskId;
  expect(taskId).toMatch(/^task-[a-f0-9]{64}$/);
  expect(records.every((r) => r.taskId === taskId)).toBe(true);
  expect(records.filter((r) => r.type === "model-call")).toHaveLength(2);
  expect(records.every((r) => r.conversation !== "urn:model-conversation")).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "awp-runtime-stats-"));
  try {
    const host = createCliHost({
      daemon,
      local: createLocalState(directory),
      ledger: h.ledger,
      accounts: vi.fn(),
      credentials: {} as never,
      openLoginUrl: vi.fn(),
      launchCommand: [],
    });
    const print = vi.fn();
    const stderr = vi.fn();
    expect(
      await runCli(["stats"], host, {
        print,
        stderr,
        confirm: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toBe(0);
    const report = JSON.parse(print.mock.calls[0]?.[0] as string);
    expect(report.tasks).toMatchObject([
      {
        taskId,
        modelCalls: 2,
        toolCalls: 2,
        inputTokens: 14,
        outputTokens: 6,
        tokens: 20,
        retries: 2,
      },
    ]);
    expect(report.unassignedEntries).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    // Cursor replay retains the task and producing Proposer call without invoking it again.
    await createDaemon(h.options).once();
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
    expect(
      h.ledger
        .entries()
        .filter(({ record }) => record.type !== "gate-decision" && record.type !== "record-anchor"),
    ).toHaveLength(records.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  "reader",
  "proposer",
] as const)("failed %s model calls retain daemon-derived task context", async (context) => {
  const h = harness();
  const call = measuredCall(context);
  if (context === "reader")
    vi.spyOn(h.options.gateway.reader, "extract").mockRejectedValueOnce(new GatewayError([call]));
  else
    vi.mocked(h.options.gateway.proposer.propose).mockRejectedValueOnce(new GatewayError([call]));
  await expect(createDaemon(h.options).once()).rejects.toThrow();
  const records = h.ledger
    .entries()
    .map((e) => e.record)
    .filter(
      (r) =>
        r.type !== "ledger-checkpoint" && r.type !== "gate-decision" && r.type !== "record-anchor",
    );
  const failure = records.find((r) => r.type === "model-call");
  expect(failure).toMatchObject({ taskId: records[0]?.taskId, inputTokens: 7, outputTokens: 3 });
  expect(failure?.taskId).toMatch(/^task-[a-f0-9]{64}$/);
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});

it("imports ACL first, deterministically triages, proposes, audits, checkpoints, and executes without listening", async () => {
  const h = harness();
  const listen = vi.spyOn(Server.prototype, "listen");
  await createDaemon(h.options).once();
  expect(listen).not.toHaveBeenCalled();
  const inbox = h.pod.requests.filter(
    (r) => r.url.includes("/inbox/direct/fixture/") && r.method === "PUT",
  );
  expect(inbox[0]?.body).toBe("");
  expect(inbox[1]?.url).toMatch(/\.acl$/);
  expect(inbox[1]?.body).toContain(OWNER);
  expect(inbox[1]?.body).not.toContain("http://xmlns.com/foaf/0.1/Agent");
  expect(inbox.some((r) => r.url.endsWith(".triage.ttl") && r.body.includes("needs_reply"))).toBe(
    true,
  );
  expect(h.state.cursors.get("fixture")).toBe("one");
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
  expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
  expect(h.ledger.entries().map((e) => e.record.type)).toEqual([
    "gate-decision",
    "ingest",
    "gate-decision",
    "proposal",
    "record-anchor",
  ]);
  expect(h.state.held()).toBe(false);
  expect([...h.pod.resources.keys()].some((url) => url.includes("agent/proposals/"))).toBe(true);
  // The agent introduces itself after the owner-only workspace ACL, before any inbox content.
  const writes = h.pod.requests.filter((r) => r.method === "PUT").map((r) => r.url);
  const introduction = writes.indexOf(`${ROOT}agent/descriptors/agent.ttl`);
  expect(introduction).toBeGreaterThan(writes.indexOf(`${ROOT}agent/.acl`));
  expect(introduction).toBeLessThan(writes.findIndex((url) => url.includes("/inbox/direct/")));
  expect(h.pod.resources.get(`${ROOT}agent/descriptors/agent.ttl`)?.body).toContain(AGENT_ID);
});
it.each([
  ["x:y.ttl", false],
  ["x%3ay.ttl", false],
  ["snow☃.ttl", false],
  ["x:y.ttl", true],
  ["x%3ay.ttl", true],
  ["snow☃.ttl", true],
] as const)("completes and replays proposal %s using its digest location (cached=%s)", async (name, cached) => {
  const h = harness();
  const id = `${h.workspace.url("proposals/")}${name}`;
  const expectedId = h.workspace.url(`proposals/${digestOf(id).slice(8)}.ttl`);
  const source = h.workspace.messageUrl(h.workspace.url("inbox/direct/fixture/"), "seed");
  const key = digestOf({ account: "fixture", source, digest: h.message.rawSha256 });
  const result = {
    proposals: [{ ...exampleRecords["action-proposal"], id }],
    calls: [measuredCall("proposer")],
  };
  if (cached) await h.state.proposalResults.put(key, result);
  else vi.mocked(h.options.gateway.proposer.propose).mockResolvedValue(result);
  const projectOutbox = vi.fn(h.options.project);
  const project: DaemonOptions["project"] = async (proposal, release) => {
    expect(proposal.id).toBe(expectedId);
    expect((await h.state.proposalResults.get(key))?.proposals[0]?.id).toBe(expectedId);
    return projectOutbox(proposal, release);
  };
  const options = { ...h.options, project };
  await createDaemon(options).once();
  await createDaemon(options).once();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledTimes(cached ? 0 : 1);
  expect(h.state.cursors.get("fixture")).toBe("one");
  expect((await h.state.proposalResults.get(key))?.proposals[0]?.id).toBe(expectedId);
  const resource = h.pod.resources.get(expectedId);
  expect(resource).toBeDefined();
  expect(await recordFromTurtle(resource?.body ?? "", expectedId)).toMatchObject({
    id: expectedId,
  });
  // Probing for an earlier release's resource is a read; nothing is written at the legacy URL.
  expect(h.pod.requests.some((r) => r.url === id && r.method !== "GET")).toBe(false);
  expect(h.ledger.entries().filter((entry) => entry.record.type === "proposal")).toHaveLength(1);
  const calls = h.ledger.entries().filter((entry) => entry.record.type === "model-call");
  expect(calls).toHaveLength(1);
  // Without earlier evidence the repaired location is used everywhere, including model calls.
  expect(calls[0]?.record).toMatchObject({ proposal: expectedId });
  expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(2);
});
/**
 * Seed the state an earlier release left for proposals/x:y.ttl: it accepted any proposals/**.ttl
 * ID and projected into the outbox before auditing model calls or publishing to the pod.
 */
async function legacyRun(
  h: ReturnType<typeof harness>,
  evidence: { calls: boolean; modelAudit: boolean; published: boolean; proposalAudit: boolean },
) {
  const legacyId = h.workspace.url("proposals/x:y.ttl");
  const expectedId = h.workspace.url(`proposals/${digestOf(legacyId).slice(8)}.ttl`);
  const source = h.workspace.messageUrl(h.workspace.url("inbox/direct/fixture/"), "seed");
  const key = digestOf({ account: "fixture", source, digest: h.message.rawSha256 });
  const task = {
    taskId: `task-${key.slice(8)}`,
    conversation: `urn:sha256:${digestOf({ account: "fixture", thread: "seed" }).slice(8)}`,
    agent: AGENT_ID,
    owner: OWNER,
  };
  // The trusted outbox is idempotent by proposal ID, as the executor's store is.
  const outbox = new Map<string, OutboxEntry>();
  const project = vi.fn<DaemonOptions["project"]>(async (proposal, release) => {
    const entry = await h.options.project(proposal, release);
    const existing = outbox.get(proposal.id);
    if (existing) return existing;
    outbox.set(proposal.id, entry);
    return entry;
  });
  const legacy = { ...exampleRecords["action-proposal"], id: legacyId };
  const entry = await project(legacy, async () => h.release(legacy));
  project.mockClear();
  const call = measuredCall("proposer");
  await h.state.proposalResults.put(key, {
    proposals: [entry.proposal],
    calls: evidence.calls ? [call] : [],
  });
  const at = new Date(AT).toISOString();
  if (evidence.modelAudit)
    h.ledger.append(
      {
        type: "model-call",
        id: call.id,
        context: call.context,
        provider: call.provider,
        model: call.model,
        tokens: call.inputTokens + call.outputTokens,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        toolCalls: call.toolCalls,
        latencyMs: Math.round(call.latencyMs),
        retries: call.retries,
        proposal: legacyId,
        ...task,
      },
      at,
    );
  if (evidence.published) {
    await h.pod.storage.write(legacyId, await recordToTurtle(entry.proposal), {
      contentType: "text/turtle",
      ifMatch: "*",
    });
    h.pod.requests.splice(0);
  }
  if (evidence.proposalAudit) {
    const terms = proposalApprovalTerms(entry);
    h.ledger.append(
      {
        type: "proposal",
        id: legacyId,
        proposal: legacyId,
        terms,
        termsDigest: digestOf(terms),
        ...task,
      },
      at,
    );
  }
  return {
    legacyId,
    expectedId,
    key,
    outbox,
    project,
    options: { ...h.options, project },
  };
}
const proposalResources = (h: ReturnType<typeof harness>) =>
  [...h.pod.resources.keys()].filter((url) => url.includes("/proposals/") && url.endsWith(".ttl"));
const evidenceRecords = (h: ReturnType<typeof harness>) =>
  h.ledger
    .entries()
    .map((entry) => entry.record)
    .filter((record) => record.type === "model-call" || record.type === "proposal");

it.each([
  ["model-call evidence", { calls: true, modelAudit: true, published: true, proposalAudit: false }],
  ["proposal evidence", { calls: true, modelAudit: true, published: true, proposalAudit: true }],
  [
    "a published resource",
    { calls: false, modelAudit: false, published: true, proposalAudit: false },
  ],
] as const)("keeps an already-projected legacy proposal id end to end given %s", async (_, evidence) => {
  const h = harness();
  const { legacyId, expectedId, key, outbox, project, options } = await legacyRun(h, evidence);
  await createDaemon(options).once();
  expect(project).toHaveBeenCalledOnce();
  expect(project.mock.calls[0]?.[0].id).toBe(legacyId);
  expect([...outbox.keys()]).toEqual([legacyId]);
  expect(proposalResources(h)).toEqual([legacyId]);
  expect(h.pod.requests.some((r) => r.url === expectedId)).toBe(false);
  expect(h.pod.requests.some((r) => r.method === "PUT" && r.url.includes("/proposals/"))).toBe(
    false,
  );
  expect((await h.state.proposalResults.get(key))?.proposals.map((p) => p.id)).toEqual([legacyId]);
  expect(h.state.cursors.get("fixture")).toBe("one");
  const records = evidenceRecords(h);
  expect(records.filter((r) => r.type === "proposal")).toEqual([
    expect.objectContaining({ id: legacyId, proposal: legacyId }),
  ]);
  expect(records.filter((r) => r.type === "model-call")).toEqual(
    evidence.calls ? [expect.objectContaining({ proposal: legacyId })] : [],
  );
  // A second pass replays without a new outbox entry, resource or evidence.
  const resource = h.pod.resources.get(legacyId);
  await createDaemon(options).once();
  expect([...outbox.keys()]).toEqual([legacyId]);
  expect(proposalResources(h)).toEqual([legacyId]);
  expect(h.pod.resources.get(legacyId)).toEqual(resource);
  expect(evidenceRecords(h)).toEqual(records);
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
  expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(2);
});
it("fails closed when a projected legacy proposal id was never published", async () => {
  const h = harness();
  const { outbox, project, options } = await legacyRun(h, {
    calls: true,
    modelAudit: true,
    published: false,
    proposalAudit: false,
  });
  const before = evidenceRecords(h);
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(createDaemon(options).once()).rejects.toThrow(
      "Legacy proposal already projected; manual migration needed",
    );
  expect(project).not.toHaveBeenCalled();
  expect(outbox.size).toBe(1);
  expect(proposalResources(h)).toEqual([]);
  expect(evidenceRecords(h)).toEqual(before);
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
it.each([
  "proposal-write",
  "projection",
  "model-audit",
  "proposal-audit",
  "cursor",
])("reuses durable proposals and model-call identities after a %s failure and restart", async (stage) => {
  const h = harness();
  const directory = await mkdtemp(join(tmpdir(), "awp-replay-"));
  try {
    const local = createLocalState(directory);
    const propose = vi.mocked(h.options.gateway.proposer.propose);
    propose.mockImplementation(async () => {
      const call = {
        id: newUrn(),
        context: "proposer" as const,
        provider: "openai" as const,
        model: "fixture",
        tokens: { input: 1, output: 2 },
        inputTokens: 1,
        outputTokens: 2,
        toolCalls: 2,
        latencyMs: 1,
        retries: 0,
      };
      return {
        calls: [call],
        proposals: ["first", "second"].map((id) => ({
          ...exampleRecords["action-proposal"],
          id: `urn:proposal:${id}`,
          wasGeneratedBy: call.id,
        })),
      };
    });
    const project = vi.fn(h.options.project);
    const write = h.workspace.proposal.bind(h.workspace);
    if (stage === "proposal-write")
      vi.spyOn(h.workspace, "proposal")
        .mockImplementationOnce(write)
        .mockRejectedValueOnce(new Error("unavailable"));
    if (stage === "projection") project.mockRejectedValueOnce(new Error("unavailable"));
    if (stage === "cursor")
      vi.spyOn(local.checkpoints, "put").mockRejectedValueOnce(new Error("unavailable"));
    if (stage === "model-audit" || stage === "proposal-audit") {
      const append = h.options.audit.append;
      let failed = false;
      h.options.audit.append = async (record, at) => {
        const entry = await append(record, at);
        if (!failed && record.type === (stage === "model-audit" ? "model-call" : "proposal")) {
          failed = true;
          throw new Error("Mirror unavailable after durable append");
        }
        return entry;
      };
    }
    await expect(createDaemon({ ...h.options, ...local, project }).once()).rejects.toThrow();
    expect(await local.checkpoints.get("fixture")).toBeUndefined();
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
    const before = [...h.pod.resources].filter(
      ([url]) => url.includes("/proposals/") && url.endsWith(".ttl"),
    );
    // Reopen filesystem state and create a new daemon, as a restarted process would.
    await createDaemon({
      ...h.options,
      ...createLocalState(directory),
      project,
    }).once();
    expect(propose).toHaveBeenCalledOnce();
    expect(await local.checkpoints.get("fixture")).toBe("one");
    for (const [url, resource] of before) expect(h.pod.resources.get(url)).toEqual(resource);
    const records = h.ledger.entries().map((entry) => entry.record);
    expect(records.filter((record) => record.type === "model-call")).toHaveLength(1);
    expect(records.filter((record) => record.type === "proposal")).toHaveLength(2);
    expect(new Set(records.map((record) => canonicalJson(record))).size).toBe(records.length);
    expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("reuses empty results and resumes a later message after a partial batch", async () => {
  const h = harness();
  h.ingest.list.mockResolvedValue({
    items: [
      { id: "seed", raw: "first" },
      { id: "later", raw: "second" },
    ],
    next: "two",
  });
  const propose = vi.mocked(h.options.gateway.proposer.propose);
  propose
    .mockResolvedValueOnce({ proposals: [], calls: [] })
    .mockRejectedValueOnce(new GatewayError());
  await expect(createDaemon(h.options).once()).rejects.toThrow("Proposer failed");
  await createDaemon(h.options).once();
  expect(propose).toHaveBeenCalledTimes(3);
  expect(h.ledger.entries().filter((entry) => entry.record.type === "proposal")).toHaveLength(1);
  expect(h.state.cursors.get("fixture")).toBe("two");
});
it("fails closed before any proposal effects when result persistence fails", async () => {
  const h = harness();
  vi.spyOn(h.state.proposalResults, "put").mockRejectedValueOnce(new Error("unavailable"));
  await expect(createDaemon(h.options).once()).rejects.toThrow("unavailable");
  expect(
    h.pod.requests.filter(
      (request) =>
        request.method === "PUT" &&
        request.url.includes("/proposals/") &&
        request.url.endsWith(".ttl"),
    ),
  ).toEqual([]);
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
it("persists finalized trusted proposals before publishing them and reuses them after restart", async () => {
  const h = harness();
  const project = vi.fn(h.options.project);
  const cache = vi.spyOn(h.state.proposalResults, "put");
  const write = h.workspace.proposal.bind(h.workspace);
  vi.spyOn(h.workspace, "proposal").mockImplementation(async (proposal) => {
    const key = cache.mock.calls.at(-1)?.[0];
    if (!key) throw new Error("Missing durable proposal result");
    expect((await h.state.proposalResults.get(key))?.proposals).toContainEqual(proposal);
    const entry = await project.mock.results.at(-1)?.value;
    if (!entry) throw new Error("Missing outbox entry");
    expect(entry.proposal).toEqual(proposal);
    expect(proposal.intent.termsDigest).toBe(proposalTermsDigest(entry));
    await write(proposal);
  });
  vi.spyOn(h.state.checkpoints, "put").mockRejectedValueOnce(new Error("cursor unavailable"));
  const options = { ...h.options, project };
  await expect(createDaemon(options).once()).rejects.toThrow("cursor unavailable");
  const published = [...h.pod.resources].filter(
    ([url]) => url.includes("/proposals/") && url.endsWith(".ttl"),
  );
  expect(published).toHaveLength(1);
  await createDaemon(options).once();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
  for (const [url, resource] of published) {
    expect(h.pod.resources.get(url)).toEqual(resource);
    const proposal = await recordFromTurtle(resource.body, url);
    const evidence = h.ledger.entries().find((entry) => entry.record.type === "proposal")?.record;
    if (proposal.type !== "action-proposal" || evidence?.type !== "proposal")
      throw new Error("Missing proposal");
    expect(proposal.intent.termsDigest).toBe(evidence.termsDigest);
  }
});
it("retries finalization persistence failure without publishing or regenerating proposals", async () => {
  const h = harness();
  const put = h.state.proposalResults.put;
  vi.spyOn(h.state.proposalResults, "put")
    .mockImplementationOnce(put)
    .mockRejectedValueOnce(new Error("finalized cache unavailable"));
  const publish = vi.spyOn(h.workspace, "proposal");
  await expect(createDaemon(h.options).once()).rejects.toThrow("finalized cache unavailable");
  expect(publish).not.toHaveBeenCalled();
  expect(h.ledger.entries().map((entry) => entry.record.type)).toEqual([
    "gate-decision",
    "ingest",
    "gate-decision",
    "record-anchor",
  ]);
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  await createDaemon(h.options).once();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(h.state.cursors.get("fixture")).toBe("one");
});
it("retries a failed audit mirror without duplicating local proposal evidence", async () => {
  const h = harness();
  const mirror = new PodMirror(h.pod.io, ROOT);
  const sync = vi.fn(async () => mirror.sync(h.ledger.entries()));
  const audit = {
    entries: () => h.ledger.entries(),
    sync,
    async append(record: Parameters<typeof h.options.audit.append>[0], at: string) {
      h.ledger.append(record, at);
      if (record.type === "proposal") throw new Error("Mirror unavailable");
      await sync();
    },
  };
  await expect(createDaemon({ ...h.options, audit }).once()).rejects.toThrow("Mirror unavailable");
  await createDaemon({ ...h.options, audit }).once();
  expect(h.ledger.entries().filter((entry) => entry.record.type === "proposal")).toHaveLength(1);
  expect(h.pod.resources.get(`${ROOT}agent/audit/chain.ttl`)?.body).toContain(
    h.ledger.entries().at(-1)?.hash,
  );
});
it("refuses changed trusted terms when replaying existing proposal evidence", async () => {
  const h = harness();
  vi.spyOn(h.state.checkpoints, "put").mockRejectedValueOnce(new Error("cursor unavailable"));
  await expect(createDaemon(h.options).once()).rejects.toThrow("cursor unavailable");
  const draft = exampleRecords["action-proposal"];
  const entry = await h.options.project(draft, async () => h.release(draft));
  await expect(
    createDaemon({
      ...h.options,
      project: async (proposal, sign) => {
        await sign();
        const changed = { ...entry, proposal, wireDigest: digestBytes("different wire") };
        changed.proposal.intent.termsDigest = proposalTermsDigest(changed);
        return changed;
      },
    }).once(),
  ).rejects.toThrow("Proposal conflict");
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
});
it("refuses an outbox entry for a different proposal before audit or cursor commits", async () => {
  const h = harness();
  await expect(
    createDaemon({
      ...h.options,
      project: async (proposal, release) => ({
        ...(await h.options.project(proposal, release)),
        proposal: { ...proposal, id: "urn:proposal:different" },
      }),
    }).once(),
  ).rejects.toThrow("Outbox proposal mismatch");
  expect(h.ledger.entries().filter((entry) => entry.record.type === "proposal")).toEqual([]);
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
it("refuses an outbox entry whose finalized approval digest does not match its trusted terms", async () => {
  const h = harness();
  const publish = vi.spyOn(h.workspace, "proposal");
  await expect(
    createDaemon({
      ...h.options,
      project: async (proposal, release) => {
        const entry = await h.options.project(proposal, release);
        entry.proposal.intent.termsDigest = digestOf("model-supplied digest");
        return entry;
      },
    }).once(),
  ).rejects.toThrow("Outbox terms digest mismatch");
  expect(publish).not.toHaveBeenCalled();
  expect(h.state.cursors.size).toBe(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
it("executes and audits daemon proposal evidence using the same signed approval", async () => {
  const h = harness();
  const at = new Date(AT).toISOString();
  const until = "2026-11-02T12:00:00.000Z";
  const mandateId = `${ROOT}agent/mandates/default.ttl`;
  const approvalId = `${ROOT}agent/approvals/fixture.trig`;
  const statusId = `${ROOT}agent/mandates/status.ttl`;
  const proposal = structuredClone(exampleRecords["action-proposal"]);
  proposal.id = h.workspace.proposalLocation("urn:proposal:fixture");
  proposal.createdAt = at;
  proposal.validUntil = until;
  Object.assign(proposal.intent, {
    action: "https://jeswr.org/ns/agent#SendMessage",
    target: "urn:target:trusted-outbox",
    binding: "gmail",
    recipientHash: `sha256:${"a".repeat(64)}`,
    amount: { value: 0, currency: "GBP" },
  });
  const renderable: OutboxEntry["renderable"] = {
    compactJws: "fixture.signed.carrier",
    message: {
      profile: "urn:profile:fixture",
      configuration: "urn:config:fixture",
      id: "urn:message:fixture",
      conversation: proposal.intent.conversation,
      kind: "invoke",
      from: { actor: AGENT_ID },
      createdAt: at,
      expiresAt: until,
      body: {
        operation: { id: proposal.intent.operation, version: "1" },
        input: {},
        basis: { kind: "public" },
      },
    },
  };
  const bytes = canonicalJson(renderable);
  const wire = { bytes, mediaType: "application/json", digest: digestBytes(bytes) };
  proposal.renderedPreview = wire.bytes;
  const outbox: OutboxEntry = {
    proposal,
    renderable,
    wire,
    wireDigest: wire.digest,
    account: { id: "own-account" },
  };
  vi.mocked(h.options.gateway.proposer.propose).mockResolvedValue({
    proposals: [proposal],
    calls: [],
  });
  const terms = proposalApprovalTerms(outbox);
  const mirror = new PodMirror(h.pod.io, ROOT);
  const writer = new AuditWriter(h.ledger, mirror);
  const project = vi.fn<DaemonOptions["project"]>(async (candidate, sign) => {
    await sign();
    const entry = { ...outbox, proposal: structuredClone(candidate) };
    entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
    return entry;
  });
  const options = {
    ...h.options,
    project,
    audit: {
      append: (record: Parameters<typeof h.options.audit.append>[0], time: string) =>
        writer.append(record, time),
      entries: () => h.ledger.entries(),
      sync: () => mirror.sync(h.ledger.entries()),
    },
  };
  await createDaemon(options).once();
  // Replaying the batch must still leave exactly one proposal for the verifier.
  await createDaemon(options).once();
  const record = h.ledger.entries().find((entry) => entry.record.type === "proposal")?.record;
  if (record?.type !== "proposal") throw new Error("Missing proposal evidence");
  expect(record.terms).toEqual(terms);
  expect(record.termsDigest).toBe(proposalTermsDigest(outbox));
  expect(project).toHaveBeenCalledBefore(h.executor.runOutboxOnce);
  const persisted = await recordFromTurtle(
    h.pod.resources.get(proposal.id)?.body ?? "",
    proposal.id,
  );
  if (persisted.type !== "action-proposal") throw new Error("Missing persisted proposal");
  expect(persisted.intent.termsDigest).not.toBe(proposal.intent.termsDigest);
  expect(persisted.intent.termsDigest).toBe(record.termsDigest);
  const ed = await generateKeyPairForSuite(`${OWNER}/ed`);
  const p256 = await generateKeyPairForSuite(`${OWNER}/approval`, "P-256");
  const profiles = await Promise.all(
    [ed, p256].map((key) =>
      publishVerificationMethod({
        controller: OWNER,
        verificationMethod: key.verificationMethod,
        key,
      }),
    ),
  );
  const put = async (url: string, body: string, type = "text/turtle") => {
    await h.pod.io(url, { method: "PUT", headers: { "content-type": type }, body });
  };
  await put(`${ROOT}profile/card`, profiles.map((profile) => profile.turtle).join("\n"));
  const mandate = defaultMandate({
    id: mandateId,
    ownerWebId: OWNER,
    agentWebId: AGENT_ID,
    recipientHashes: terms.recipientHashes,
    now: new Date(AT),
  });
  const vc = await issueMandate(mandate, ed, {
    statusListCredential: statusId,
    statusListIndex: "1",
  });
  await put(mandateId, await mandateToTurtle(vc), "application/trig");
  const status = await issue({
    credential: await buildBitstringStatusListCredential({
      id: statusId,
      issuer: OWNER,
      statusPurpose: "revocation",
      validFrom: at,
      validUntil: until,
    }),
    key: ed,
    options: { created: new Date(AT) },
  });
  await put(statusId, JSON.stringify(status), "application/ld+json");
  await put(
    approvalId,
    await issueApproval(
      {
        id: approvalId,
        approves: record.id,
        termsDigest: persisted.intent.termsDigest,
        expires: until,
        decision: "approve",
      },
      p256,
      new Date(AT),
    ),
    "application/trig",
  );
  const stores = createMemoryStores(at);
  const projected = await project.mock.results.at(-1)?.value;
  if (!projected) throw new Error("Missing outbox entry");
  stores.entries.set(proposal.id, projected);
  const transmit = vi.fn(async () => ({
    outcome: "accepted" as const,
    providerRef: "fixture:sent",
  }));
  const approvalChecks = vi.fn(async (context: ApprovalContext) => {
    const response = await h.pod.io(approvalId);
    const checked = await verifyApproval(await response.text(), {
      id: approvalId,
      ownerWebId: OWNER,
      proposal: context.proposal,
      termsDigest: context.termsDigest,
      now: () => context.now,
      webIdKeyResolver: createWebIdKeyResolver({ fetch: h.pod.io }),
    });
    return checked.valid ? [checked.approval] : [];
  });
  const executor = createExecutor({
    ownerWebId: OWNER,
    agentWebId: AGENT_ID,
    proposals: stores.proposals,
    approvals: { findVerified: approvalChecks },
    controls: stores.controls,
    clock: stores.clock,
    transmissions: stores.transmissions,
    audit: stores.audit,
    mandates: { load: async () => mandate },
    policy: solidOdrlEngine,
    tokens: { send: async () => ({ access: "send", accessToken: "synthetic" }) },
    bindings: {
      gmail: {
        id: "gmail",
        carriage: { id: "fixture", structured: "native", footer: "none", maxBytes: 65536 },
        send: {
          render: async () => wire,
          preview: async (wire) => wire.bytes,
          validate: async () => ({ ok: true }),
          transmit,
        },
      },
    },
    dryRun: false,
  });
  expect(await executor.transmit(proposal.id)).toMatchObject({ status: "sent" });
  expect(transmit).toHaveBeenCalledOnce();
  expect(approvalChecks).toHaveBeenCalledWith(
    expect.objectContaining({ termsDigest: record.termsDigest }),
  );
  const common = {
    agent: AGENT_ID,
    owner: OWNER,
    proposal: record.id,
    mandate: mandateId,
    terms,
    termsDigest: digestOf(terms),
  };
  await writer.append(
    { ...common, type: "decision", id: "urn:decision:fixture", decision: "confirm-required" },
    at,
  );
  await writer.append(
    {
      type: "approval-seen",
      id: "urn:approval-seen:fixture",
      agent: AGENT_ID,
      owner: OWNER,
      proposal: record.id,
      approval: approvalId,
    },
    at,
  );
  await writer.append(
    {
      ...common,
      type: "transmission",
      id: "urn:transmission:fixture",
      decisionRecord: "urn:decision:fixture",
      approval: approvalId,
      status: "sent",
    },
    at,
  );
  await writer.append(
    {
      type: "receipt",
      id: "urn:receipt:fixture",
      agent: AGENT_ID,
      owner: OWNER,
      proposal: record.id,
      transmission: "urn:transmission:fixture",
    },
    at,
  );
  expect(await auditArtifact({ fetch: h.pod.io, root: ROOT, proposal: record.id })).toMatchObject({
    ok: true,
    breaches: [],
  });
});
it("requires an inbound gate", () => {
  const h = harness();
  expect(() => createDaemon({ ...h.options, gate: undefined } as unknown as DaemonOptions)).toThrow(
    "Missing inbound gate",
  );
});

it("opens the durable gate under the process lease and closes it after executor drain", async () => {
  const h = harness();
  const root = await mkdtemp(join(tmpdir(), "awp-gate-lease-"));
  const directory = join(root, "gate");
  try {
    await initGate({
      directory,
      ownerDir: join(root, "owner"),
      agentWebId: AGENT_ID,
      ownerWebId: OWNER,
      now: () => new Date(AT),
      confirm: async () => true,
    });
    const gate = createInboundGate({ directory, now: () => new Date(AT) });
    const open = gate.open?.bind(gate);
    if (!open) throw new Error("Missing durable gate open");
    let closed = false;
    vi.spyOn(gate, "open").mockImplementation(async (identity) => {
      expect(h.state.held()).toBe(true);
      const runtime = await open(identity);
      const close = runtime.close.bind(runtime);
      vi.spyOn(runtime, "close").mockImplementation(async () => {
        expect(h.state.held()).toBe(true);
        expect(h.executor.drain).toHaveBeenCalledOnce();
        await close();
        closed = true;
      });
      return runtime;
    });
    await createDaemon({ ...h.options, gate, accounts: [] }).once();
    expect(gate.open).toHaveBeenCalledExactlyOnceWith({ actor: AGENT_ID, party: OWNER });
    expect(closed).toBe(true);
    expect(h.state.held()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "admitted",
  "unstructured",
  "refused",
] as const)("routes a structured message with a %s verdict", async (outcome) => {
  const h = harness();
  const verdict = { outcome, digest: `sha-256:${h.message.rawSha256}` };
  const gate = { ...h.options.gate, check: vi.fn(async () => verdict) };
  const reader = vi.spyOn(h.options.gateway.reader, "extract");
  await createDaemon({ ...h.options, gate }).once();
  expect(h.ingest.parse).toHaveBeenCalledOnce();
  expect(gate.check).toHaveBeenCalledExactlyOnceWith({
    account: "fixture",
    binding: "direct",
    message: h.message,
    replayKey: expect.stringMatching(/^sha-256:[a-f0-9]{64}$/),
  });
  expect(reader).toHaveBeenCalledTimes(outcome === "refused" ? 0 : 1);
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledTimes(outcome === "admitted" ? 1 : 0);
  if (outcome === "admitted") {
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledWith(
      [expect.objectContaining({ gate: verdict })],
      { ...h.options.proposerContext, memoryRecall: expect.any(Function) },
    );
  }
  const resources = [...h.pod.resources.keys()];
  expect(resources.some((path) => path.endsWith(".txt"))).toBe(outcome !== "refused");
  expect(h.ledger.entries().some(({ record }) => record.type === "ingest")).toBe(
    outcome !== "refused",
  );
  expect(h.state.cursors.get("fixture")).toBe("one");
});

it("rolls back the entire batch before any inbox write when a gate check throws", async () => {
  const h = harness();
  h.ingest.list.mockResolvedValue({
    items: [
      { id: "first", raw: h.message.textBody },
      { id: "second", raw: h.message.textBody },
    ],
    next: "one",
  });
  const gate = {
    ...h.options.gate,
    check: vi
      .fn()
      .mockResolvedValueOnce({ outcome: "admitted", digest: `sha-256:${h.message.rawSha256}` })
      .mockRejectedValueOnce(new Error("Gate unavailable")),
  };
  const reader = vi.spyOn(h.options.gateway.reader, "extract");
  await expect(createDaemon({ ...h.options, gate }).once()).rejects.toThrow("Gate unavailable");
  expect(h.ingest.parse).toHaveBeenCalledTimes(2);
  expect(
    h.pod.requests.some(({ url, method }) => method === "PUT" && url.includes("/direct/")),
  ).toBe(false);
  expect(h.state.cursors.size).toBe(0);
  expect(h.ledger.entries().map(({ record }) => record.type)).toEqual([
    "gate-decision",
    "record-anchor",
  ]);
  expect(reader).not.toHaveBeenCalled();
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
});

it.each([
  ["bad-signature", {}],
  ["unknown-key", {}],
  ["expired", { expiresAt: "2026-10-19T07:50:00Z", createdAt: "2026-10-19T07:00:00Z" }],
  ["not-yet-valid", { createdAt: "2026-10-19T08:10:00Z" }],
  ["wrong-audience", { to: { actor: "https://other.example/agent#id" } }],
  ["unsupported-configuration", { configuration: "urn:example:unsupported-configuration" }],
  ["replay-conflict", {}],
  ["conflicting-structured-copies", {}],
  ["human-parity-mismatch", {}],
  ["malformed", {}],
  ["bounds-exceeded", {}],
] as const)("refuses %s through the daemon's inbound gate", async (reason, changes) => {
  const { gate, peer, receiver, sign, now } = await createTestGate(undefined, {
    actor: AGENT_ID,
    party: OWNER,
  });
  try {
    const message = {
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: "urn:uuid:00000000-0000-4000-8000-000000000001",
      conversation: "urn:uuid:00000000-0000-4000-8000-100000000001",
      kind: "describe",
      from: { actor: peer.identity.actor },
      to: { actor: receiver.identity.actor },
      createdAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + 3_600_000).toISOString(),
      body: {},
    };
    function input(blocks: string[], warnings: string[] = []) {
      const raw = blocks.join("\n");
      return {
        account: "fixture",
        binding: "direct",
        message: {
          channel: "direct",
          textBody: raw,
          signals: {},
          rawSha256: digestBytes(raw).slice(8),
          rawByteLength: Buffer.byteLength(raw),
          rawMediaType: "application/json",
          warnings,
          jsonLdBlocks: blocks,
        },
      };
    }
    const jws = await sign({ ...message, ...changes });
    let blocks = [encodeEnvelope(jws)];
    const warnings = [];
    switch (reason) {
      case "bad-signature": {
        const [header, payload, signature] = jws.split(".") as [string, string, string];
        const bytes = Buffer.from(signature, "base64url");
        bytes[0] = (bytes[0] as number) ^ 1;
        blocks = [encodeEnvelope(`${header}.${payload}.${bytes.toString("base64url")}`)];
        break;
      }
      case "unknown-key": {
        const stranger = await new Cast(now).add(
          { ...peer.identity, name: "unpinned" },
          mandateOf("deny-all", []),
          [],
        );
        blocks = [encodeEnvelope((await craftSigned(stranger, message)).jws)];
        break;
      }
      case "replay-conflict":
        expect(await gate.check(input(blocks))).toMatchObject({ outcome: "admitted" });
        blocks = [encodeEnvelope(await sign({ ...message, expiresAt: "2026-10-19T09:01:00Z" }))];
        break;
      case "conflicting-structured-copies":
        blocks.push(encodeEnvelope("abc.def.ghi"));
        break;
      case "human-parity-mismatch":
        warnings.push("human-parity-unverified");
        break;
      case "malformed":
        blocks = ['{"@type":"agent:SignedMessage"}'];
        break;
      case "bounds-exceeded":
        blocks = [blocks[0]?.replace(jws, `${"a".repeat(65_536)}.b.c`) as string];
        break;
    }
    const h = harness();
    const checked = input(blocks, warnings);
    h.ingest.parse.mockReturnValue(checked.message);
    h.ingest.list.mockResolvedValue({
      items: [{ id: "rejected", raw: checked.message.textBody }],
      next: "one",
    });
    const extract = vi.spyOn(h.options.gateway.reader, "extract");
    const check = vi.spyOn(gate, "check");
    await createDaemon({ ...h.options, gate, isFlagged: async () => true }).once();
    expect(await check.mock.results[0]?.value).toMatchObject({ outcome: "refused", reason });
    expect(extract).not.toHaveBeenCalled();
    expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
    expect(h.pod.requests.some(({ url }) => url.includes("/inbox/direct/"))).toBe(false);
    expect(h.ledger.entries().some(({ record }) => record.type === "ingest")).toBe(false);
    const gateDecisions = h.ledger
      .entries()
      .filter(({ record }) => record.type === "gate-decision" && record.outcome === "refuse");
    expect(gateDecisions).toHaveLength(1);
    expect(gateDecisions[0]?.record).toMatchObject({
      direction: "in",
      outcome: "refuse",
      reason,
      configuration: CONFIG_ED25519,
      messageDigest: `sha-256:${checked.message.rawSha256}`,
    });

    expect(h.state.cursors.get("fixture")).toBe("one");
    expect((await gate.status()).ledger.ok).toBe(true);
  } finally {
    await gate.close();
  }
});

it("drops a genuinely bad signature and admits the valid signed message down the same reader", async () => {
  const h = harness();
  const { gate, sign, peer, receiver, now } = await createTestGate(undefined, {
    actor: AGENT_ID,
    party: OWNER,
  });
  try {
    const messageId = "urn:uuid:00000000-0000-4000-8000-000000000051";
    const jws = await sign({
      profile: PILOT_PROFILE,
      configuration: CONFIG_ED25519,
      id: messageId,
      conversation: "urn:uuid:00000000-0000-4000-8000-100000000051",
      kind: "describe",
      from: { actor: peer.identity.actor },
      to: { actor: receiver.identity.actor },
      createdAt: now().toISOString(),
      expiresAt: "2026-10-19T09:00:00Z",
      body: {},
    });
    const [header, payload, proof] = jws.split(".") as [string, string, string];
    const signature = Buffer.from(proof, "base64url");
    signature[0] = (signature[0] as number) ^ 1;
    const bad = encodeEnvelope(`${header}.${payload}.${signature.toString("base64url")}`);
    const good = encodeEnvelope(jws);
    const reader = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    );
    h.ingest.parse.mockImplementation(reader.ingest.parse);
    const extracted = vi.spyOn(h.options.gateway.reader, "extract");
    const gateCheck = vi.spyOn(gate, "check");
    const daemon = createDaemon({ ...h.options, gate });
    h.ingest.list.mockResolvedValue({ items: [{ id: "bad", raw: bad }], next: "one" });
    await daemon.once();
    expect(await gateCheck.mock.results[0]?.value).toMatchObject({
      outcome: "refused",
      reason: "bad-signature",
    });
    expect(extracted).not.toHaveBeenCalled();
    expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
    expect(h.pod.requests.some(({ url }) => url.includes("/inbox/direct/"))).toBe(false);
    expect(h.ledger.entries().map(({ record }) => record.type)).toEqual([
      "gate-decision",
      "record-anchor",
    ]);

    const batch = { items: [{ id: "good", raw: good }], next: "two" };
    h.ingest.list.mockResolvedValue(batch);
    await daemon.once();
    await daemon.once();
    const verdict = await gateCheck.mock.results[1]?.value;
    expect(verdict).toMatchObject({ outcome: "admitted", messageId });
    expect(await gateCheck.mock.results[2]?.value).toEqual(verdict);
    expect(extracted).toHaveBeenCalledWith(
      expect.objectContaining({ gate: verdict }),
      expect.anything(),
    );
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledExactlyOnceWith(
      [expect.objectContaining({ gate: verdict })],
      { ...h.options.proposerContext, memoryRecall: expect.any(Function) },
    );
    expect([...h.pod.resources.values()].filter(({ body }) => body === good)).toHaveLength(1);
    expect(h.ledger.entries().filter(({ record }) => record.type === "ingest")).toHaveLength(1);
    expect((await gate.status()).ledger.ok).toBe(true);
  } finally {
    await gate.close();
  }
});

it.each([false, true])("stores and triages plain email with owner flag %s", async (flagged) => {
  const h = harness();
  const { gate } = await createTestGate(undefined, { actor: AGENT_ID, party: OWNER });
  const raw = [
    "From: peer@example.test",
    "To: receiver@example.test",
    "Message-ID: <fictional-message@example.test>",
    "Subject: A fictional invitation",
    "",
    "Can you reply today?",
  ].join("\r\n");
  const accounts = [
    {
      id: "fixture",
      enabled: true,
      category: "email" as const,
      binding: { id: "email-mime", ingest: h.ingest },
    },
  ];
  h.ingest.list.mockResolvedValue({ items: [{ id: "email", raw }], next: "one" });
  h.ingest.parse.mockImplementation(
    (item) =>
      inspectEmail(item.raw, {
        parseEmail,
        recipient: "receiver@example.test",
        ownAccounts: new Set(["receiver@example.test"]),
      }).message,
  );
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  try {
    await createDaemon({ ...h.options, gate, accounts, isFlagged: async () => flagged }).once();
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ gate: expect.objectContaining({ outcome: "unstructured" }) }),
      expect.anything(),
    );
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledTimes(flagged ? 1 : 0);
    expect([...h.pod.resources.values()].filter(({ body }) => body === raw)).toHaveLength(1);
    expect((await gate.status()).verdicts.unstructured).toBe(1);
  } finally {
    await gate.close();
  }
});

it("imports Latin-1 HTML mail before committing its cursor", async () => {
  const h = harness();
  const { gate } = await createTestGate(undefined, { actor: AGENT_ID, party: OWNER });
  const raw = [
    "From: peer@example.test",
    "To: receiver@example.test",
    "Content-Type: text/html; charset=iso-8859-1",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>Caf=E9</p>",
  ].join("\r\n");
  h.ingest.list.mockResolvedValue({ items: [{ id: "latin1", raw }], next: "one" });
  h.ingest.parse.mockImplementation(
    (item) =>
      inspectEmail(item.raw, {
        parseEmail,
        recipient: "receiver@example.test",
        ownAccounts: new Set(["receiver@example.test"]),
      }).message,
  );
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  try {
    await createDaemon({ ...h.options, gate }).once();
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        textBody: " Café ",
        gate: expect.objectContaining({ outcome: "unstructured" }),
      }),
      expect.anything(),
    );
    expect([...h.pod.resources.values()].filter(({ body }) => body === raw)).toHaveLength(1);
    expect(h.state.cursors.get("fixture")).toBe("one");
  } finally {
    await gate.close();
  }
});

it.each([
  ["application/octet-stream", "attachment"],
  ["text/html", "<p>Ordinary attachment</p>"],
])("imports ordinary mail with 13 %s attachments before committing its cursor", async (type, body) => {
  const h = harness();
  const { gate } = await createTestGate(undefined, { actor: AGENT_ID, party: OWNER });
  const raw = [
    "From: peer@example.test",
    "To: receiver@example.test",
    'Content-Type: multipart/mixed; boundary="parts"',
    "",
    "--parts",
    "Content-Type: text/plain",
    "",
    "Ordinary mail",
    ...Array.from({ length: 13 }, () => [
      "--parts",
      `Content-Type: ${type}`,
      "Content-Disposition: attachment",
      "",
      body,
    ]).flat(),
    "--parts--",
  ].join("\r\n");
  h.ingest.list.mockResolvedValue({ items: [{ id: "attachments", raw }], next: "one" });
  h.ingest.parse.mockImplementation(
    ({ raw }) =>
      inspectEmail(raw, {
        parseEmail,
        recipient: "receiver@example.test",
        ownAccounts: new Set(["receiver@example.test"]),
      }).message,
  );
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  try {
    await createDaemon({ ...h.options, gate }).once();
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        textBody: "Ordinary mail",
        gate: expect.objectContaining({ outcome: "unstructured" }),
      }),
      expect.anything(),
    );
    expect([...h.pod.resources.values()].filter(({ body }) => body === raw)).toHaveLength(1);
    expect(h.state.cursors.get("fixture")).toBe("one");
  } finally {
    await gate.close();
  }
});

it.each([
  "email-mime",
  "graph-teams",
])("records the %s conflict before committing its cursor", async (channel) => {
  const h = harness();
  const directory = await mkdtemp(join(tmpdir(), "daemon-conflict-gate-"));
  const gateDirectory = join(directory, "gate");
  const card = (jws: string) => ({
    contentType: "application/vnd.microsoft.card.adaptive",
    content: JSON.stringify({
      type: "AdaptiveCard",
      version: "1.4",
      body: [],
      data: { envelope: encodeEnvelopeObject(jws) },
    }),
  });
  const attachments = [card("a.b.c"), card("a.b.d")];
  const email = [
    "From: peer@example.test",
    "To: receiver@example.test",
    'Content-Type: multipart/mixed; boundary="parts"',
    "",
    ...["a.b.c", "a.b.d"].flatMap((jws) => [
      "--parts",
      "Content-Type: application/ld+json",
      "",
      encodeEnvelope(jws),
    ]),
    "--parts--",
  ].join("\r\n");
  h.ingest.list.mockResolvedValue({ items: [{ id: "mail", raw: email }], next: "one" });
  h.ingest.parse.mockImplementation(
    ({ raw }) =>
      inspectEmail(raw, {
        parseEmail,
        recipient: "receiver@example.test",
        ownAccounts: new Set(["receiver@example.test"]),
      }).message,
  );
  const binding =
    channel === "graph-teams"
      ? createGraphTeamsReader(
          teams.reader([
            teams.page([{ id: teams.chat }]),
            teams.page([teams.row({ attachments })]),
            teams.page(),
          ]).config,
        )
      : { id: channel, ingest: h.ingest };
  const raw = channel === "graph-teams" ? teams.item({ attachments }).raw : email;
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  const put = h.options.checkpoints.put.bind(h.options.checkpoints);
  h.options.checkpoints.put = async (account, cursor) => {
    const entries = readLedgerSegment(join(gateDirectory, "ledger.jsonl"));
    expect(entries.map((entry) => entry.record)).toContainEqual(
      expect.objectContaining({
        type: "binding-rejection",
        binding: channel,
        digest: digestBytes(raw),
        reason: "conflicting-structured-copies",
      }),
    );
    await put(account, cursor);
  };
  try {
    await initGate({
      agentWebId: AGENT_ID,
      ownerWebId: OWNER,
      directory: gateDirectory,
      ownerDir: join(directory, "owner"),
      confirm: async () => true,
    });
    await createDaemon({
      ...h.options,
      accounts: [{ id: "fixture", enabled: true, category: "chat", binding }],
      gate: createInboundGate({ directory: gateDirectory }),
    }).once();
    expect(h.state.cursors.get("fixture")).toBeDefined();
    expect(extract).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("records a body-free Teams refusal before checkpointing the later valid message", async () => {
  const h = harness();
  const { gate, ledger } = await createTestGate(undefined, { actor: AGENT_ID, party: OWNER });
  const oversized = { id: "oversized", subject: "x".repeat(65_536) };
  const { binding } = teams.reader([
    teams.page([{ id: teams.chat }]),
    teams.page([teams.row(oversized), teams.row({ id: "later" })]),
    teams.page(),
  ]);
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  const put = h.options.checkpoints.put.bind(h.options.checkpoints);
  h.options.checkpoints.put = async (account, cursor) => {
    expect(ledger.entries().map(({ record }) => record)).toContainEqual(
      expect.objectContaining({
        type: "binding-rejection",
        binding: "graph-teams",
        digest: digestBytes(teams.item(oversized).raw),
        reason: "bounds-exceeded",
      }),
    );
    await put(account, cursor);
  };
  try {
    await createDaemon({
      ...h.options,
      accounts: [{ id: "fixture", enabled: true, category: "chat", binding }],
      gate,
    }).once();
    expect(h.state.cursors.get("fixture")).toBeDefined();
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ messageId: teams.item({ id: "later" }).id }),
      expect.anything(),
    );
  } finally {
    await gate.close();
  }
});

it("durably refuses a Matrix parser failure before a bridge retry can hide the carrier", async () => {
  const h = harness();
  const directory = await mkdtemp(join(tmpdir(), "daemon-matrix-gate-"));
  const gateDirectory = join(directory, "gate");
  const identity = { agentWebId: AGENT_ID, ownerWebId: OWNER };
  const native = event("$malformed", {
    msgtype: "m.text",
    body: "Fixture",
    "org.jeswr.agent.envelope": { malformed: true },
  });
  const item = { id: native.event_id, raw: JSON.stringify(native) };
  const bridged = { ...item, native: JSON.stringify({ bridge: "signal", event: native }) };
  expect(() => parseMatrixMessage(item)).toThrow(ChannelParseError);
  expect(() => parseMatrixMessage(bridged)).toThrow(ChannelParseError);
  h.ingest.list
    .mockResolvedValueOnce({ items: [bridged], next: "one" })
    .mockResolvedValueOnce({ items: [item], next: "two" });
  h.ingest.parse.mockImplementation(parseMatrixMessage);
  const extract = vi.spyOn(h.options.gateway.reader, "extract");
  const options: DaemonOptions = {
    ...h.options,
    accounts: [
      {
        id: "fixture",
        enabled: true,
        category: "chat",
        binding: { id: "matrix", ingest: h.ingest },
      },
    ],
  };
  try {
    await initGate({
      ...identity,
      directory: gateDirectory,
      ownerDir: join(directory, "owner"),
      confirm: async () => true,
    });
    await createDaemon({
      ...options,
      gate: createInboundGate({ directory: gateDirectory }),
    }).once();
    expect(h.state.cursors.get("fixture")).toBe("one");
    await createDaemon({
      ...options,
      gate: createInboundGate({ directory: gateDirectory }),
    }).once();
    expect(extract).not.toHaveBeenCalled();
    expect([...h.pod.resources.values()].some(({ body }) => body === item.raw)).toBe(false);
    expect(h.state.cursors.get("fixture")).toBe("two");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it.each([
  20_000,
  DIRECT.maxBytes,
])("keeps a supported %i-byte direct envelope eligible before committing its cursor", async (size) => {
  const h = harness();
  const reader = createDirectReader(
    { inboxes: new Map(), accepted: new Map() },
    new RecordingTokenProvider(),
  );
  const carrier = {
    "@context": { agent: "https://jeswr.org/ns/agent#" },
    "@type": "agent:SignedMessage",
    "agent:wireFormat": "jws-compact",
    "agent:compactJws": "a.b.c",
  };
  const padding = size - Buffer.byteLength(canonicalJson(carrier));
  carrier["agent:compactJws"] = `${"a".repeat(padding + 1)}.b.c`;
  const block = canonicalJson(carrier);
  expect(Buffer.byteLength(block)).toBe(size);
  expect(reader.ingest.parse({ id: "seed", raw: block }).jsonLdBlocks).toEqual([block]);
  h.ingest.list.mockResolvedValue({ items: [{ id: "seed", raw: block }], next: "one" });
  await createDaemon({
    ...h.options,
    accounts: [
      {
        id: "fixture",
        category: "chat",
        enabled: true,
        binding: { id: "direct", ingest: { ...h.ingest, parse: reader.ingest.parse } },
      },
    ],
  }).once();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
  expect(h.state.cursors.get("fixture")).toBe("one");
});
it("bounds structured eligibility even for a custom channel parser", async () => {
  const h = harness();
  const carrier = JSON.parse(h.message.jsonLdBlocks?.[0] ?? "null");
  carrier["agent:compactJws"] = `${"a".repeat(DIRECT.maxBytes)}.b.c`;
  Object.assign(h.message, { jsonLdBlocks: [canonicalJson(carrier)] });
  await createDaemon(h.options).once();
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
});
it.each([
  "not JSON",
  '{"@type":"https://schema.org/Event"}',
  '{"@context":"https://untrusted.example/context","@type":"agent:SignedMessage"}',
  '{"@context":{"agent":"https://jeswr.org/ns/agent#"},"@type":"agent:SignedMessage","agent:wireFormat":"jws-compact","agent:compactJws":"invalid"}',
])("does not treat unrelated or malformed metadata as a proposer envelope: %s", async (block) => {
  const h = harness();
  Object.assign(h.message, { jsonLdBlocks: [block] });
  await createDaemon(h.options).once();
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
});
it("never commits a cursor or executes after an ACL, inbox, model, audit, or cursor failure", async () => {
  for (const stage of ["acl", "inbox", "model", "audit", "cursor"]) {
    const h = harness();
    if (stage === "acl" || stage === "inbox") {
      const original = h.workspace.io;
      Object.defineProperty(h.workspace, "io", {
        value: async (input: string, init?: RequestInit) =>
          (stage === "acl" && input.endsWith(".acl")) ||
          (stage === "inbox" && input.endsWith(".txt"))
            ? new Response(null, { status: 403 })
            : original(input, init),
      });
    }
    if (stage === "model")
      vi.mocked(h.options.gateway.proposer.propose).mockRejectedValueOnce(new GatewayError());
    if (stage === "audit")
      h.options.audit.append = async () => {
        throw new Error("unavailable");
      };
    if (stage === "cursor")
      h.options.checkpoints.put = async () => {
        throw new Error("unavailable");
      };
    await expect(createDaemon(h.options).once()).rejects.toThrow();
    expect(h.state.cursors.size).toBe(0);
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
    expect(h.state.held()).toBe(false);
  }
});
it("holds the cursor when the gate cannot record a parser refusal or ingest exceeds the bound", async () => {
  const h = harness();
  h.ingest.parse.mockImplementationOnce(() => {
    throw new ChannelParseError("fixture");
  });
  await expect(createDaemon(h.options).once()).rejects.toThrow("Inbound gate");
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
  expect(h.state.cursors.size).toBe(0);
  await expect(
    createDaemon({ ...h.options, limits: { maxItems: 1, maxBytes: 1 } }).once(),
  ).rejects.toThrow("bound");
});
it("refuses a cancelled single pass before acquiring the lease", async () => {
  const h = harness();
  const acquire = vi.spyOn(h.state.lease, "acquire");
  await expect(createDaemon(h.options).once(AbortSignal.abort())).rejects.toThrow();
  expect(acquire).not.toHaveBeenCalled();
  expect(h.ingest.list).not.toHaveBeenCalled();
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  expect(h.state.held()).toBe(false);
});
it("keeps a single pass single even with a live cancellation signal", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  const controller = new AbortController();
  const pass = createDaemon({ ...h.options, now: Date.now }).once(controller.signal);
  await vi.advanceTimersByTimeAsync(300_000);
  controller.abort();
  await pass;
  expect(h.ingest.list).toHaveBeenCalledOnce();
  expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
  expect(h.state.held()).toBe(false);
});
it.each([
  { stage: "ingest", fails: false },
  { stage: "ingest", fails: true },
  { stage: "proposer", fails: false },
  { stage: "proposer", fails: true },
])("maintains single-pass $stage without a signal and clears timers (failure: $fails)", async ({
  stage,
  fails,
}) => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  }).then(() => {
    if (fails) throw new Error("Suspended operation failed");
  });
  if (stage === "ingest") {
    const original = h.ingest.list.getMockImplementation();
    if (!original) throw new Error("Fixture list missing");
    h.ingest.list.mockImplementationOnce(async (...args) => {
      await wait;
      return original(...args);
    });
  } else {
    const propose = vi.mocked(h.options.gateway.proposer.propose);
    const original = propose.getMockImplementation();
    if (!original) throw new Error("Fixture proposer missing");
    propose.mockImplementationOnce(async (...args) => {
      await wait;
      return original(...args);
    });
  }
  const pass = createDaemon({ ...h.options, now: Date.now }).once();
  const settled = fails
    ? expect(pass).rejects.toThrow(
        stage === "proposer" ? "Proposer failed" : "Suspended operation failed",
      )
    : pass;
  try {
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.ingest.list).toHaveBeenCalledOnce();
    if (stage === "proposer") expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
    expect(h.executor.onControlOrMandateChange).toHaveBeenCalledTimes(5);
    expect(h.executor.onApprovalChange).toHaveBeenCalledTimes(5);
    expect(
      h.pod.requests.filter((r) => r.url.endsWith("heartbeat.ttl") && r.method === "PUT"),
    ).toHaveLength(3);
    expect(h.state.held()).toBe(true);
  } finally {
    finish();
    await settled;
  }
  expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(fails ? 0 : 1);
  expect(h.executor.drain).toHaveBeenCalledOnce();
  expect(h.state.held()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(h.ingest.list).toHaveBeenCalledOnce();
  expect(h.executor.onControlOrMandateChange).toHaveBeenCalledTimes(5);
  expect(h.executor.onApprovalChange).toHaveBeenCalledTimes(5);
});
it("cancels a single pass during ingest before execution and holds its lease through drain", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  let finishIngest!: () => void;
  let finishDrain!: () => void;
  const ingestWait = new Promise<void>((resolve) => {
    finishIngest = resolve;
  });
  const drainWait = new Promise<void>((resolve) => {
    finishDrain = resolve;
  });
  const list = h.ingest.list.getMockImplementation();
  if (!list) throw new Error("Fixture list missing");
  h.ingest.list.mockImplementationOnce(async (...args) => {
    await ingestWait;
    return list(...args);
  });
  h.executor.drain.mockImplementationOnce(async () => drainWait);
  const controller = new AbortController();
  const pass = createDaemon({ ...h.options, now: Date.now }).once(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.ingest.list).toHaveBeenCalledOnce();
  controller.abort();
  expect(h.state.held()).toBe(true);
  finishIngest();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  expect(h.executor.drain).toHaveBeenCalledOnce();
  expect(h.state.held()).toBe(true);
  await expect(h.state.lease.acquire()).rejects.toThrow("Lease held");
  finishDrain();
  await pass;
  expect(h.state.held()).toBe(false);
});
it("serializes accounts sharing a binding and respects email/chat/social intervals", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  const first = h.options.accounts[0];
  if (!first) throw new Error("Fixture account missing");
  const options = {
    ...h.options,
    now: Date.now,
    accounts: ["email", "chat", "social"].map((category) => ({
      ...first,
      id: category,
      category: category as "email" | "chat" | "social",
    })),
  };
  let completed!: () => void;
  let nextPass = new Promise<void>((resolve) => {
    completed = resolve;
  });
  h.executor.runOutboxOnce.mockImplementation(async () => {
    completed();
    return {};
  });
  const controller = new AbortController();
  const run = createDaemon(options).run(controller.signal);
  // Finish storage work before moving the simulated scheduler clock.
  await nextPass;
  await vi.advanceTimersByTimeAsync(0);
  for (let tick = 0; tick < 10; tick++) {
    nextPass = new Promise<void>((resolve) => {
      completed = resolve;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await nextPass;
    await vi.advanceTimersByTimeAsync(0);
  }
  controller.abort();
  await run;
  expect(pollInterval("email")).toBe(120_000);
  expect(h.ingest.list.mock.calls.filter(([account]) => account.id === "email")).toHaveLength(3);
  expect(h.ingest.list.mock.calls.filter(([account]) => account.id === "chat")).toHaveLength(11);
  expect(h.ingest.list.mock.calls.filter(([account]) => account.id === "social")).toHaveLength(2);
  expect(h.notifications.subscribe).toHaveBeenCalledWith(
    [`${ROOT}agent/control/`, `${ROOT}agent/approvals/`],
    expect.objectContaining({ pollIntervalMs: 30000 }),
  );
  expect(
    h.pod.requests.filter((r) => r.method === "PUT" && r.url.endsWith("heartbeat.ttl")),
  ).toHaveLength(6);
  expect(h.subscription.close).toHaveBeenCalledOnce();
});
it("polls and heartbeats even while ingest is suspended; detects approvals, removals and reconnects", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const original = h.ingest.list.getMockImplementation();
  if (!original) throw new Error("Fixture list missing");
  h.ingest.list.mockImplementation(async (...args) => {
    await wait;
    return original(...args);
  });
  const controller = new AbortController();
  const run = createDaemon({ ...h.options, now: Date.now }).run(controller.signal);
  await vi.advanceTimersByTimeAsync(60000);
  expect(h.executor.onApprovalChange).toHaveBeenCalledTimes(3);
  expect(
    h.pod.requests.filter((r) => r.url.endsWith("heartbeat.ttl") && r.method === "PUT"),
  ).toHaveLength(2);
  const before = h.executor.onApprovalChange.mock.calls.length;
  h.changes[0]?.({ object: `${ROOT}agent/approvals/removed.ttl`, type: "Delete" } as ChangeEvent);
  expect(h.executor.onApprovalChange).toHaveBeenCalledTimes(before + 1);
  h.resyncs[0]?.();
  expect(h.executor.onApprovalChange).toHaveBeenCalledTimes(before + 2);
  controller.abort();
  finish();
  await run;
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
it("falls back on failed subscription and fences execution after reconciliation failure", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  vi.mocked(h.notifications.subscribe).mockRejectedValueOnce(new Error("fixture"));
  const controller = new AbortController();
  const run = createDaemon({ ...h.options, now: Date.now }).run(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  h.executor.onApprovalChange.mockRejectedValueOnce(new Error("fixture"));
  const failed = expect(run).rejects.toThrow("reconciliation");
  await vi.advanceTimersByTimeAsync(30000);
  await failed;
  expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(1);
  expect(h.state.held()).toBe(false);
});
it("holds its process lease through a failed watcher close and delayed executor drain", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness();
  let finish!: () => void;
  h.executor.drain.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const daemon = createDaemon({ ...h.options, now: Date.now });
  const run = daemon.run(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  await expect(daemon.once()).rejects.toThrow("already running");
  vi.mocked(h.subscription.close).mockRejectedValueOnce(new Error("close failed"));
  const failed = expect(run).rejects.toThrow("close failed");
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.state.held()).toBe(true);
  finish();
  await failed;
  expect(h.state.held()).toBe(false);
});

const memoryPurpose = "urn:test:personalisation";
const memoryOperation = { id: "urn:test:provide-assessment", version: "1" };
const memoryIssuer = "urn:test:assessor";
const memoryAt = new Date(AT).toISOString();
const assessment = {
  id: "urn:test:assessment",
  claimType: "assessment",
  issuer: memoryIssuer,
  subject: "urn:test:subject",
  asOf: memoryAt,
  method: "recorded-by-authority",
  value: "Appointment confirmed",
  terms: {
    policy: {
      id: "urn:test:assessment-terms",
      permissions: [{ type: "permission", action: "use" }],
    },
  },
};
const recalledAssessment = {
  kind: "admitted-fact",
  id: assessment.id,
  subject: assessment.subject,
  statement: assessment,
  provenance: {
    source: memoryIssuer,
    asOf: memoryAt,
    method: assessment.method,
    digest: digestOf(assessment),
    terms: assessment.terms,
    admittedPurpose: memoryPurpose,
  },
};
const memoryAdmission = {
  taskId: "urn:test:personalisation-task",
  reliance: {
    id: "urn:test:reliance",
    rules: [
      {
        id: "urn:test:fitness",
        claimType: "assessment",
        methods: ["recorded-by-authority"],
        maxAgeDays: 30,
        text: "Require the accepted assessor's recent record.",
      },
    ],
  },
  handlers: [
    {
      description: {
        ...memoryOperation,
        label: "Receive assessment",
        access: "public" as const,
        pattern: "invoke" as const,
        roles: ["responder"] as const,
        models: [],
        effects: [],
        outcomes: [],
      },
      requiresRepresentation: false,
      onInvoke: (_context: unknown, body: { input: { refuse?: unknown } }) =>
        body.input.refuse
          ? ({ type: "refuse", reason: "not-authorised" } as const)
          : ({ type: "none" } as const),
    },
  ],
};

async function memoryGateFixture(
  root: string,
  variant: "valid" | "bad-signature" | "unknown-source" | "plain",
  admission = memoryAdmission,
) {
  const directory = join(root, "gate");
  const now = () => new Date(AT);
  await initGate({
    directory,
    ownerDir: join(root, "owner"),
    agentWebId: AGENT_ID,
    ownerWebId: OWNER,
    now,
    confirm: async () => true,
  });
  const cast = new Cast(now);
  const peer = await cast.add(
    {
      name: "peer",
      actor: "https://peer.example/agent#id",
      party: "https://peer.example/owner#id",
    },
    mandateOf("memory-fixture", []),
    [],
  );
  const issuerKey = await testKey("daemon-memory:issuer");
  const stored = await readGate(directory);
  let trust = pinIssuer(introduce(stored.trust, peer.card), memoryIssuer, issuerKey);
  if (variant !== "unknown-source") {
    trust = addSourceRule(trust, {
      id: "urn:test:source-rule",
      version: "1",
      source: memoryIssuer,
      claimTypes: admission.reliance.rules.map(({ claimType }) => claimType),
      subjects: "any",
    });
  }
  await saveTrust(root, "gate", trust);
  const options = { directory, now, admission };
  async function signedInvocation(
    sequence: number,
    statement: JsonObject,
    purpose?: string,
    refuse = false,
  ) {
    return (
      await craftSigned(peer, {
        profile: PILOT_PROFILE,
        configuration: CONFIG_ED25519,
        id: `urn:uuid:00000000-0000-4000-8000-0000000000${sequence}`,
        conversation: `urn:uuid:00000000-0000-4000-8000-1000000000${sequence}`,
        kind: "invoke",
        from: { actor: peer.identity.actor },
        to: { actor: AGENT_ID },
        createdAt: memoryAt,
        expiresAt: new Date(AT + 3_600_000).toISOString(),
        body: {
          operation: memoryOperation,
          input: { refuse },
          ...(purpose !== undefined && { purpose }),
          basis: { kind: "public" },
        },
        evidence: [
          {
            role: "credential",
            format: "jws-compact",
            value: await signClaim(issuerKey, statement),
          },
        ],
      })
    ).jws;
  }
  const jws = await signedInvocation(61, assessment, memoryPurpose);
  const [header, payload, proof] = jws.split(".") as [string, string, string];
  const signature = Buffer.from(proof, "base64url");
  signature[0] = (signature[0] as number) ^ 1;
  const raw =
    variant === "plain"
      ? JSON.stringify(assessment)
      : encodeEnvelope(
          variant === "bad-signature"
            ? `${header}.${payload}.${signature.toString("base64url")}`
            : jws,
        );
  return { options, raw, signedInvocation };
}

it.each([
  "valid",
  "bad-signature",
  "unknown-source",
  "plain",
] as const)("exposes only admitted evidence to the Proposer's memory_recall tool (%s)", async (variant) => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-"));
  try {
    const { options, raw } = await memoryGateFixture(root, variant);
    const h = harness();
    const gate = createInboundGate(options);
    const memory = createRuntimeMemory({
      facts: () => gate.facts(),
      owner: { recall: async () => [] },
      purpose: memoryPurpose,
    });
    const usage = { input_tokens: 10, output_tokens: 10 };
    const provider = fakeFetch([
      Response.json({
        status: "completed",
        usage,
        output: [
          {
            type: "function_call",
            call_id: "memory-test",
            name: "memory_recall",
            arguments: JSON.stringify({ query: "assessment" }),
          },
        ],
      }),
      Response.json({ status: "completed", usage, output: [] }),
    ]);
    const { proposer } = createGateway({
      provider: "openai",
      model: "synthetic",
      maxTokens: 100,
      tokens: { read: async () => "synthetic-token" },
      account: "synthetic",
      fetch: provider.fetch,
    });
    h.ingest.parse.mockImplementation(
      variant === "plain"
        ? () => ({
            ...h.message,
            textBody: raw,
            rawSha256: digestBytes(raw).slice(8),
            rawByteLength: Buffer.byteLength(raw),
            jsonLdBlocks: [],
          })
        : createDirectReader(
            { inboxes: new Map(), accepted: new Map() },
            new RecordingTokenProvider(),
          ).ingest.parse,
    );
    h.ingest.list.mockResolvedValue({ items: [{ id: "fixture", raw }], next: "one" });
    await createDaemon({
      ...h.options,
      memory,
      gate,
      gateway: { ...h.options.gateway, proposer },
      isFlagged: async () => variant === "plain",
    }).once();
    expect(h.state.cursors.get("fixture")).toBe("one");
    if (variant === "bad-signature") {
      expect(provider.requests).toHaveLength(0);
      const reopened = await openGate(options);
      try {
        expect(reopened.facts()).toEqual([]);
      } finally {
        await reopened.close();
      }
    } else {
      expect(provider.requests).toHaveLength(2);
      const body = JSON.parse(String(provider.requests[1]?.init?.body));
      const output = body.input.find(
        (item: { type?: string }) => item.type === "function_call_output",
      );
      expect(JSON.parse(output.output)).toMatchObject({
        items: variant === "valid" ? [recalledAssessment] : [],
        withheld: 0,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("hides an inbound fact when the decision record fails to commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-uncommitted-"));
  try {
    const { options, signedInvocation } = await memoryGateFixture(root, "valid");
    const delivery = carriageBytes({
      format: "awp-jws-compact/0.1",
      jws: await signedInvocation(61, assessment, memoryPurpose),
    });
    const gate = await openGate(options);
    const commit = AgentRuntime.prototype.commitBindingEvent;
    const duringCommit = vi.fn(() => gate.facts());
    const failure = new Error("decision commit failed");
    const write = vi
      .spyOn(AgentRuntime.prototype, "commitBindingEvent")
      .mockImplementation(function (this: AgentRuntime, record) {
        if (record.type === "suite-gate-decision" && record.outcome === "admit") {
          duringCommit();
          return Promise.reject(failure);
        }
        return commit.call(this, record);
      });
    try {
      await expect(
        gate.receiveCarriage({ binding: "direct-http", delivery }, new AbortController().signal),
      ).rejects.toThrow(failure);
      expect(duringCommit).toHaveReturnedWith([]);
      expect(gate.facts()).toEqual([]);
    } finally {
      write.mockRestore();
      await gate.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("recalls the same admitted fact after reopening its gate directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-restart-"));
  try {
    const { options, raw } = await memoryGateFixture(root, "valid");
    const message = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    ).ingest.parse({ id: "fixture", raw });
    const gate = await openGate(options);
    try {
      expect(await gate.check({ account: "fixture", binding: "direct", message })).toMatchObject({
        outcome: "admitted",
      });
      expect(gate.facts()).toMatchObject([expect.objectContaining({ id: assessment.id })]);
    } finally {
      await gate.close();
    }
    const reopened = await openGate(options);
    try {
      const memory = createRuntimeMemory({
        facts: () => reopened.facts(),
        owner: { recall: async () => [] },
        purpose: memoryPurpose,
      });
      expect(await memory.recall("assessment")).toMatchObject({
        items: [recalledAssessment],
        withheld: 0,
      });
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { revision: "changed", value: "Refused replacement" },
  { revision: "identical", value: assessment.value },
])("keeps the admitted revision after a refused $revision delivery", async ({ value }) => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-refused-revision-"));
  try {
    const { options, signedInvocation } = await memoryGateFixture(root, "valid");
    const reader = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    );
    const verifyRecall = async (gate: Awaited<ReturnType<typeof openGate>>) => {
      const memory = createRuntimeMemory({
        facts: gate.facts,
        owner: { recall: async () => [] },
        purpose: memoryPurpose,
      });
      expect.soft(await memory.recall("assessment")).toMatchObject({
        items: [recalledAssessment],
        withheld: 0,
      });
    };
    const gate = await openGate(options);
    try {
      const deliver = (jws: string) =>
        gate.check({
          account: "fixture",
          binding: "direct",
          message: reader.ingest.parse({ id: "fixture", raw: encodeEnvelope(jws) }),
        });
      expect(await deliver(await signedInvocation(61, assessment, memoryPurpose))).toMatchObject({
        outcome: "admitted",
      });
      await verifyRecall(gate);
      expect(
        await deliver(await signedInvocation(62, { ...assessment, value }, undefined, true)),
      ).toMatchObject({ outcome: "refused", reason: "not-authorised" });
      await verifyRecall(gate);
    } finally {
      await gate.close();
    }
    const reopened = await openGate(options);
    try {
      await verifyRecall(reopened);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "refused",
  "interaction-only",
  "repeat",
  "superseded",
  "refused-successor",
  "refused-successor-revision",
] as const)("preserves the %s recall result across restart", async (variant) => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-review-"));
  try {
    const refusedSuccessor =
      variant === "refused-successor" || variant === "refused-successor-revision";
    const admission = {
      ...memoryAdmission,
      reliance: {
        ...memoryAdmission.reliance,
        rules: memoryAdmission.reliance.rules.map((rule) => ({
          ...rule,
          ...((variant === "superseded" || refusedSuccessor) && {
            precedence: { sources: [memoryIssuer], freshness: "newer-first" as const },
          }),
        })),
      },
    };
    const { options, signedInvocation } = await memoryGateFixture(root, "valid", admission);
    const reader = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    );
    const { terms: _terms, ...noTerms } = assessment;
    const revision = { ...assessment, value: "Replacement assessment" };
    const replacement = {
      ...revision,
      id: "urn:test:replacement",
      asOf: memoryAt,
    };
    const older = { ...assessment, asOf: new Date(AT - 60_000).toISOString() };
    const priorSuccessor = { ...replacement, subject: "urn:test:another-subject" };
    const deliveries =
      variant === "refused"
        ? [await signedInvocation(61, assessment, memoryPurpose, true)]
        : variant === "interaction-only"
          ? [
              await signedInvocation(61, assessment),
              await signedInvocation(62, { ...noTerms, id: replacement.id }, memoryPurpose),
              await signedInvocation(63, { ...assessment, id: "urn:test:scoped" }, memoryPurpose),
            ]
          : variant === "repeat"
            ? [
                await signedInvocation(61, assessment, memoryPurpose),
                await signedInvocation(62, revision, memoryPurpose),
                await signedInvocation(63, assessment, "urn:test:other-purpose"),
              ]
            : [
                ...(variant === "refused-successor-revision"
                  ? [await signedInvocation(60, priorSuccessor, memoryPurpose)]
                  : []),
                await signedInvocation(61, older, memoryPurpose),
                await signedInvocation(62, replacement, memoryPurpose, refusedSuccessor),
              ];
    const gate = await openGate(options);
    const recall = (active: typeof gate, purpose = memoryPurpose, query = "assessment") =>
      createRuntimeMemory({
        facts: active.facts,
        owner: { recall: async () => [] },
        purpose,
      }).recall(query);
    const verifyRecall = async (active: typeof gate, phase: string) => {
      const result = await recall(active);
      if (variant === "refused") {
        expect(active.facts()).toEqual([]);
        expect(result).toEqual({ items: [], withheld: 0 });
      } else if (variant === "interaction-only") {
        const unscoped = active.facts().find(({ id }) => id === assessment.id);
        expect(unscoped).toBeDefined();
        expect(unscoped?.admittedPurpose).toBeUndefined();
        expect.soft(result).toMatchObject({
          items: [{ id: "urn:test:scoped", provenance: { terms: assessment.terms } }],
          withheld: 2,
        });
        expect(await recall(active, "urn:test:other-purpose")).toEqual({ items: [], withheld: 3 });
        expect.soft(await recall(active, memoryPurpose, "no-match")).toEqual({
          items: [],
          withheld: 2,
        });
      } else if (variant === "repeat") {
        expect(result).toEqual({ items: [], withheld: 1 });
        expect(await recall(active, "urn:test:other-purpose")).toMatchObject({
          items: [
            {
              ...recalledAssessment,
              provenance: {
                ...recalledAssessment.provenance,
                admittedPurpose: "urn:test:other-purpose",
              },
            },
          ],
          withheld: 0,
        });
      } else if (refusedSuccessor) {
        expect.soft(result, phase).toMatchObject({
          items: [
            ...(variant === "refused-successor-revision"
              ? [{ id: priorSuccessor.id, statement: priorSuccessor }]
              : []),
            { id: older.id, statement: older, provenance: { supersededBy: undefined } },
          ],
          withheld: 0,
        });
      } else {
        expect(result.items).toHaveLength(1);
        expect(result).toMatchObject({ items: [{ id: replacement.id }], withheld: 1 });
        expect(await recall(active, memoryPurpose, "no-match")).toEqual({ items: [], withheld: 1 });
      }
    };
    try {
      for (const [index, jws] of deliveries.entries()) {
        const message = reader.ingest.parse({ id: "fixture", raw: encodeEnvelope(jws) });
        expect(await gate.check({ account: "fixture", binding: "direct", message })).toMatchObject(
          variant === "refused" || (refusedSuccessor && index === deliveries.length - 1)
            ? { outcome: "refused", reason: "not-authorised" }
            : { outcome: "admitted" },
        );
      }
      if (variant === "refused") {
        const state = readRuntimeStateFile(join(options.directory, "state.json"));
        expect(state.contextItems[memoryAdmission.taskId]).toContainEqual(
          expect.objectContaining({ id: assessment.id, accepted: true }),
        );
      }
      if (refusedSuccessor) {
        const state = readRuntimeStateFile(join(options.directory, "state.json"));
        expect(state.precedenceHolds[older.id]).toMatchObject({ supersededBy: replacement.id });
      }
      await verifyRecall(gate, "live");
    } finally {
      await gate.close();
    }
    const reopened = await openGate(options);
    try {
      await verifyRecall(reopened, "after restart");
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "default",
  "supplier",
] as const)("enforces a derived fact's inherited %s terms live and after restart", async (terms) => {
  const root = await mkdtemp(join(tmpdir(), "daemon-memory-derived-"));
  try {
    const rule = ruleSchema.parse({
      id: "urn:test:assessment-threshold",
      template: "threshold",
      params: { input: "assessment", operator: "gte", value: 1 },
      output: "eligible",
      inputsFrom: [memoryIssuer],
    });
    const [assessmentRule] = memoryAdmission.reliance.rules;
    if (!assessmentRule) throw new Error("Missing assessment reliance rule");
    const { options, signedInvocation } = await memoryGateFixture(root, "valid", {
      ...memoryAdmission,
      reliance: {
        ...memoryAdmission.reliance,
        rules: [
          assessmentRule,
          { ...assessmentRule, claimType: rule.output, methods: ["derived"] },
        ],
      },
    });
    const input = { ...assessment, value: 2, ...(terms === "default" && { terms: undefined }) };
    const reader = createDirectReader(
      { inboxes: new Map(), accepted: new Map() },
      new RecordingTokenProvider(),
    );
    const create = AgentRuntime.create.bind(AgentRuntime);
    // Install a trusted rule for the fixture's real reference admission. Recall after reopening
    // reads the persisted proof and terms without needing to run the rule again.
    const setup = vi
      .spyOn(AgentRuntime, "create")
      .mockImplementationOnce((config) =>
        create({ ...config, gates: { ...config.gates, rules: [rule] } }),
      );
    const gate = await openGate(options).finally(() => setup.mockRestore());
    const verifyRecall = async (active: typeof gate, id: string, phase: string) => {
      expect(active.facts().find((fact) => fact.id === id)).toMatchObject({
        admittedPurpose: memoryPurpose,
        terms: { inherited: [{ target: input.id, terms: input.terms ?? null }] },
      });
      const memory = createRuntimeMemory({
        facts: active.facts,
        owner: { recall: async () => [] },
        purpose: memoryPurpose,
      });
      expect.soft(await memory.recall("eligible"), phase).toMatchObject({
        items: terms === "default" ? [] : [{ id }],
        withheld: terms === "default" ? 2 : 0,
      });
    };
    let derivedId: string;
    try {
      const deliver = (jws: string) =>
        gate.check({
          account: "fixture",
          binding: "direct",
          message: reader.ingest.parse({ id: "fixture", raw: encodeEnvelope(jws) }),
        });
      expect(await deliver(await signedInvocation(61, input, memoryPurpose))).toMatchObject({
        outcome: "admitted",
      });
      const source = gate.facts().find((fact) => fact.id === input.id);
      if (!source?.digest) throw new Error("Missing admitted input");
      const task = options.admission.taskId;
      const memory = new GateMemory();
      memory.enter(task, { ...source, kind: "statement", accepted: true, digest: source.digest });
      memory.restoreFacts();
      const derived = evaluateRule({
        rules: [rule],
        rule: rule.id,
        memory,
        task,
        subject: input.subject,
        deriver: memoryIssuer,
        at: memoryAt,
        purpose: memoryPurpose,
      });
      if (!derived.ok || typeof derived.statement.id !== "string")
        throw new Error("Missing derived statement");
      derivedId = derived.statement.id;
      expect(
        await deliver(await signedInvocation(62, derived.statement, memoryPurpose)),
      ).toMatchObject({
        outcome: "admitted",
      });
      await verifyRecall(gate, derivedId, "live");
    } finally {
      await gate.close();
    }
    const reopened = await openGate(options);
    try {
      await verifyRecall(reopened, derivedId, "after restart");
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("caches and audits a gate refusal without publishing or trying the proposal again", async () => {
  const h = harness();
  const project = vi.fn(h.options.project);
  const release = vi.fn(async () => ({ ok: false, reason: "unsupported-operation" }) as const);
  const daemon = createDaemon({ ...h.options, project, gate: { ...h.options.gate, release } });
  await daemon.once();
  await daemon.once();
  expect(release).toHaveBeenCalledOnce();
  expect(
    h.ledger
      .entries()
      .filter(({ record }) => record.type === "gate-decision" && record.direction === "out")
      .map(({ record }) => record),
  ).toMatchObject([{ outcome: "stop", reason: "unsupported-operation" }]);
  expect(project).toHaveBeenCalledOnce();
  expect(h.options.gateway.proposer.propose).toHaveBeenCalledOnce();
  const source = h.workspace.messageUrl(h.workspace.url("inbox/direct/fixture/"), "seed");
  const key = digestOf({ account: "fixture", source, digest: h.message.rawSha256 });
  const proposal = project.mock.calls[0]?.[0];
  if (!proposal) throw new Error("Expected a projected proposal");
  expect((await h.state.proposalResults.get(key))?.refused).toEqual([
    { id: proposal.id, reason: "unsupported-operation" },
  ]);
  expect(h.pod.resources.has(proposal.id)).toBe(false);
  const refusals = h.ledger
    .entries()
    .filter(({ record }) => record.type === "decision" && record.status === "refused");
  expect(refusals).toHaveLength(1);
  expect(refusals[0]?.record).toMatchObject({
    proposal: proposal.id,
    reason: "unsupported-operation",
  });
});

it("writes a gate decision before handing the signed proposal to the projector", async () => {
  const h = harness();
  const project: DaemonOptions["project"] = async (proposal, sign) => {
    const release = await sign();
    if (!release.ok) throw new Error("Fixture release was refused");
    expect(h.ledger.entries().at(-1)?.record).toMatchObject({
      type: "gate-decision",
      direction: "out",
      outcome: "go",
      messageDigest: digestBytes(release.renderable.compactJws),
    });
    return h.options.project(proposal, sign);
  };
  await createDaemon({ ...h.options, project }).once();
  expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
});

it("keeps rendering and execution behind a durable outbound gate decision", async () => {
  const h = harness();
  const { append } = h.options.audit;
  h.options.audit.append = async (record, at) => {
    if (record.type === "gate-decision" && record.direction === "out")
      throw new Error("Gate audit unavailable");
    return append(record, at);
  };
  const render = vi.fn(h.options.project);
  const project: DaemonOptions["project"] = async (proposal, sign) => {
    try {
      await sign();
      return render(proposal, sign);
    } catch {
      throw new ProposalRefusedError("unsupported-operation");
    }
  };
  await expect(createDaemon({ ...h.options, project }).once()).rejects.toThrow(
    "Gate audit unavailable",
  );
  expect(render).not.toHaveBeenCalled();
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  expect(h.state.cursors.size).toBe(0);
});

it("seals a moved audit head at heartbeat and shutdown, retrying if another writer advances it", async () => {
  const h = harness();
  const at = new Date(AT).toISOString();
  const control = { type: "control", agent: AGENT_ID, owner: OWNER } as const;
  const first = h.ledger.append({ ...control, id: "urn:control:heartbeat" }, at);
  const port = testRecordPort(AGENT_ID, OWNER);
  const anchor = vi.fn(port.anchor);
  anchor.mockImplementationOnce(async (head, publish) => {
    expect(head).toEqual({ seq: first.seq, hash: first.hash });
    h.ledger.append({ ...control, id: "urn:control:concurrent" }, at);
    return port.anchor(head, publish);
  });
  h.executor.runOutboxOnce.mockImplementationOnce(async () => {
    expect(h.ledger.entries().at(-1)?.record).toMatchObject({
      type: "record-anchor",
      seq: 2,
    });
    h.ledger.append({ ...control, id: "urn:control:shutdown" }, at);
    return {};
  });
  const daemon = createDaemon({
    ...h.options,
    accounts: [],
    gate: { ...h.options.gate, head: port.head, anchor, release: vi.fn() },
  });
  await daemon.once();
  expect(h.ledger.entries().at(-1)?.record).toMatchObject({ type: "record-anchor", seq: 4 });
  expect(anchor).toHaveBeenCalledTimes(3);
  await daemon.once();
  expect(anchor).toHaveBeenCalledTimes(3);
});

it.each([
  "local append",
  "mirror",
] as const)("recovers a refused check after %s failure and reopening the daemon", async (failure) => {
  const h = harness();
  const directory = await mkdtemp(join(tmpdir(), "brief-41-recovery-"));
  const ref = {
    directory: join(directory, "gate"),
    ownerDir: join(directory, "owner"),
    agentWebId: AGENT_ID,
    ownerWebId: OWNER,
    now: () => new Date(AT),
  };
  try {
    await initGate({ ...ref, confirm: async () => true });
    const { append } = h.options.audit;
    let interrupted = false;
    h.options.audit.append = async (record, at) => {
      if (record.type === "gate-decision" && !interrupted) {
        interrupted = true;
        if (failure === "mirror") await append(record, at);
        throw new Error("Interrupted after gate commit");
      }
      return append(record, at);
    };
    const start = (accounts = h.options.accounts) =>
      createDaemon({ ...h.options, accounts, gate: createInboundGate(ref) }).once();
    await expect(start()).rejects.toThrow("Interrupted after gate commit");
    expect(h.state.cursors.size).toBe(0);
    const decisions = () =>
      h.ledger.entries().filter(({ record }) => record.type === "gate-decision");
    expect(decisions()).toHaveLength(failure === "mirror" ? 1 : 0);
    if (failure === "local append") {
      // An empty account list proves startup recovery runs independently of redelivery.
      await start([]);
      expect(decisions()).toHaveLength(1);
    }
    await start();
    expect(decisions()).toHaveLength(1);
    const decision = decisions()[0]?.record;
    if (decision?.type !== "gate-decision") throw new Error("Missing linked decision");
    const { gateSeq, gateHash } = decision;
    expect(decision).toMatchObject({
      id: `urn:sha256:${digestOf({ gateSeq, gateHash }).slice(8)}`,
      direction: "in",
      outcome: "refuse",
      messageDigest: `sha-256:${h.message.rawSha256}`,
    });
    expect(h.state.cursors.get("fixture")).toBe("one");
    expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function withDurableGate(
  exercise: (ref: Parameters<typeof openGate>[0], directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "brief-41q-"));
  const ref = { directory: join(directory, "gate"), now: () => new Date(AT) };
  try {
    await initGate({
      ...ref,
      ownerDir: join(directory, "owner"),
      agentWebId: AGENT_ID,
      ownerWebId: OWNER,
      confirm: async () => true,
    });
    await exercise(ref, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it.each([
  "before gate decision append",
  "after gate decision fsync",
] as const)("reconciles exactly one completed check after a crash %s", async (boundary) =>
  withDurableGate(async (ref) => {
    const h = harness();
    const gateLedger = join(ref.directory, "ledger.jsonl");
    const gateDecisions = () =>
      readLedgerSegment(gateLedger).filter(({ record }) => record.type === "suite-gate-decision");
    const start = (accounts = h.options.accounts) =>
      createDaemon({ ...h.options, accounts, gate: createInboundGate(ref) }).once();
    const reader = vi.spyOn(h.options.gateway.reader, "extract");
    const save = FileStateStore.prototype.save;
    const commit = AgentRuntime.prototype.commitBindingEvent;
    const crash = new Error("simulated gate process exit");
    const write =
      boundary === "after gate decision fsync"
        ? vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (
            this: FileStateStore,
            state,
          ) {
            if (gateDecisions().length) throw crash;
            save.call(this, state);
          })
        : vi.spyOn(AgentRuntime.prototype, "commitBindingEvent").mockImplementation(function (
            this: AgentRuntime,
            record,
          ) {
            if (record.type === "suite-gate-decision") return Promise.reject(crash);
            return commit.call(this, record);
          });
    try {
      await expect(start()).rejects.toThrow(crash);
      expect(gateDecisions()).toHaveLength(boundary === "after gate decision fsync" ? 1 : 0);
      expect(reader).not.toHaveBeenCalled();
      expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
      expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
      expect(h.ledger.entries()).toHaveLength(0);
    } finally {
      write.mockRestore();
    }
    const decisions = () =>
      h.ledger.entries().filter(({ record }) => record.type === "gate-decision");
    h.executor.runOutboxOnce.mockImplementationOnce(async () => {
      expect(decisions().map(({ record }) => record)).toMatchObject([
        {
          direction: "in",
          outcome: "refuse",
          reason: "malformed",
          messageDigest: `sha-256:${h.message.rawSha256}`,
        },
      ]);
      return {};
    });
    await start([]);
    await start();
    expect(decisions()).toHaveLength(1);
    expect(gateDecisions()).toHaveLength(1);
  }));

it("fails closed when restoring an older gate snapshot beside the suite decisions", async () =>
  withDurableGate(async (ref, directory) => {
    const h = harness();
    const initial = await openGate(ref);
    await initial.close();
    const snapshot = ["state.json", "ledger.jsonl"].map((name) => ({
      path: join(ref.directory, name),
      backup: join(directory, `older-${name}`),
    }));
    await Promise.all(snapshot.map(({ path, backup }) => copyFile(path, backup)));
    const start = () => createDaemon({ ...h.options, gate: createInboundGate(ref) }).once();
    await start();
    const reader = vi.spyOn(h.options.gateway.reader, "extract");
    h.executor.runOutboxOnce.mockClear();
    await Promise.all(snapshot.map(({ path, backup }) => copyFile(backup, path)));
    await expect(start()).rejects.toThrow("Audit ledger gate record missing");
    expect(reader).not.toHaveBeenCalled();
    expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
  }));

it("reconciles from the pruned gate decision watermark when no linked decisions remain", async () =>
  withDurableGate(async (ref, directory) => {
    const h = harness();
    const path = join(directory, "events.jsonl");
    let ledger = new FileLedger(path, { segmentMaxEntries: 2, maxSegments: 1 });
    const audit: DaemonOptions["audit"] = {
      append: async (record, at) => ledger.append(record, at),
      entries: () => ledger.entries(),
      sync: async () => undefined,
    };
    const start = (accounts = h.options.accounts) =>
      createDaemon({ ...h.options, accounts, audit, gate: createInboundGate(ref) }).once();
    await start();
    const linked = ledger.entries().find(({ record }) => record.type === "gate-decision")?.record;
    if (linked?.type !== "gate-decision") throw new Error("Missing linked decision");
    const control = () =>
      ledger.append(
        { type: "control", id: "urn:control:retention", agent: AGENT_ID, owner: OWNER },
        new Date(AT).toISOString(),
      );
    for (let i = 0; i < 3; i++) {
      control();
      await start([]);
    }
    for (let i = 0; i < 5; i++) control();
    expect(ledger.entries().some(({ record }) => record.type === "gate-decision")).toBe(false);
    ledger = new FileLedger(path, { segmentMaxEntries: 2, maxSegments: 1 });
    const append = vi.spyOn(audit, "append");
    await start([]);
    expect(append).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "gate-decision" }),
      expect.any(String),
    );
    expect(ledger.entries().map(({ record }) => record)).toContainEqual(
      expect.objectContaining({
        type: "ledger-checkpoint",
        lastPrunedGate: { seq: linked.gateSeq, hash: linked.gateHash },
      }),
    );
  }));

it.each([
  "retained decision",
  "suite checkpoint",
] as const)("starts after gate retention prunes the link in a %s", async (link) =>
  withDurableGate(async (ref, directory) => {
    const h = harness();
    const at = new Date(AT).toISOString();
    const gate = await openGate(ref);
    const digest = digestBytes("synthetic delivery");
    let head: ReturnType<typeof gate.head>;
    try {
      await gate.recordParseRefusal({
        binding: "direct",
        account: "fixture",
        reason: "malformed",
        digest,
      });
      head = gate.head();
    } finally {
      await gate.close();
    }
    const decision = h.ledger.append(
      {
        agent: AGENT_ID,
        owner: OWNER,
        id: "urn:decision:retention",
        type: "gate-decision",
        direction: "in",
        outcome: "refuse",
        reason: "malformed",
        messageDigest: digest,
        configuration: CONFIG_ED25519,
        gateSeq: head.seq,
        gateHash: head.hash,
      },
      at,
    );
    const retained =
      link === "retained decision"
        ? decision
        : seal(2, at, decision.hash, {
            type: "ledger-checkpoint",
            lastPrunedSeq: decision.seq,
            lastPrunedHash: decision.hash,
            lastPrunedGate: head,
          });
    const path = join(directory, "events.jsonl");
    await writeFile(path, `${JSON.stringify(retained)}\n`);
    const audit = new FileLedger(path);
    const ledger = new ReferenceLedger(join(ref.directory, "ledger.jsonl"), {
      segmentMaxEntries: 1,
      maxSegments: 1,
    });
    for (let i = 0; i < 3; i++) ledger.append({ type: "fixture" }, at);
    expect(ledger.entries()[0]?.seq).toBeGreaterThan(head.seq);
    const store = new FileStateStore(join(ref.directory, "state.json"));
    try {
      store.save({ ...store.load(), ledgerAuditHead: ledger.head() });
    } finally {
      store.close();
    }
    await createDaemon({
      ...h.options,
      accounts: [],
      audit: {
        append: async (record, time) => audit.append(record, time),
        entries: () => audit.entries(),
        sync: async () => undefined,
      },
      gate: createInboundGate(ref),
    }).once();
    expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(1);
    const print = vi.fn();
    const host = createCliHost({
      gate: { stateDirectory: directory, agentWebId: AGENT_ID, ownerWebId: OWNER },
      daemon: async () => {
        throw new Error("Local audit does not start the daemon");
      },
      local: createLocalState(directory),
      ledger: audit,
      accounts: vi.fn(),
      credentials: {} as never,
      openLoginUrl: vi.fn(),
      launchCommand: [],
    });
    expect(
      await runCli(["audit", "--ledger", path], host, {
        print,
        confirm: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).toBe(0);
    expect(print).toHaveBeenCalledWith("unverifiable-pruned gate links: 1");
    expect(print).toHaveBeenCalledWith("PASS");
  }));

it("rejects a forged startup anchor even when the gate already witnessed its head", async () =>
  withDurableGate(async (ref) => {
    const h = harness();
    const reader = vi.spyOn(h.options.gateway.reader, "extract");
    const at = new Date(AT).toISOString();
    const identity = { agent: AGENT_ID, owner: OWNER };
    const { seq, hash } = h.ledger.append(
      { ...identity, type: "control", id: "urn:control:head" },
      at,
    );
    const gate = await openGate(ref);
    try {
      const jws = await gate.anchor({ seq, hash });
      h.ledger.append(
        {
          ...identity,
          type: "record-anchor",
          id: "urn:anchor:forged",
          seq,
          hash,
          jws: jws.replace(/\.[^.]+$/, `.${"a".repeat(86)}`),
        },
        at,
      );
    } finally {
      await gate.close();
    }
    await expect(
      createDaemon({ ...h.options, gate: createInboundGate(ref) }).once(),
    ).rejects.toThrow("invalid anchor signature at record 2");
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  }));

it("witnesses the exact durable orphan anchor before dispatch, only once across restarts", async () =>
  withDurableGate(async (ref) => {
    const h = harness();
    const at = new Date(AT).toISOString();
    const identity = { agent: AGENT_ID, owner: OWNER };
    const { seq, hash } = h.ledger.append(
      { ...identity, type: "control", id: "urn:control:head" },
      at,
    );
    const gate = await openGate(ref);
    try {
      await expect(
        gate.anchor({ seq, hash }, async (jws) => {
          h.ledger.append(
            { ...identity, type: "record-anchor", id: "urn:anchor:orphan", seq, hash, jws },
            at,
          );
          throw new Error("crashed before witnessing");
        }),
      ).rejects.toThrow("crashed before witnessing");
    } finally {
      await gate.close();
    }
    const witnesses = () =>
      readLedgerSegment(join(ref.directory, "ledger.jsonl"))
        .filter(({ record }) => record.type === "record-anchor-receipt")
        .map(({ record }) => record);
    expect(witnesses()).toHaveLength(0);
    h.executor.runOutboxOnce.mockImplementation(async () => {
      expect(witnesses()).toMatchObject([{ seq, hash }]);
      return {};
    });
    const start = () =>
      createDaemon({ ...h.options, accounts: [], gate: createInboundGate(ref) }).once();
    await start();
    await start();
    expect(h.executor.runOutboxOnce).toHaveBeenCalledTimes(2);
    expect(h.ledger.entries()).toHaveLength(2);
  }));

it.each([
  "healthy",
  "interrupted",
] as const)("audits a release through the factory signer with a %s audit writer", async (mode) => {
  const h = harness();
  const directory = await mkdtemp(join(tmpdir(), "brief-41-factory-release-"));
  const ref = {
    directory: join(directory, "gate"),
    ownerDir: join(directory, "owner"),
    agentWebId: AGENT_ID,
    ownerWebId: OWNER,
    now: () => new Date(AT),
  };
  try {
    await initGate({ ...ref, confirm: async () => true });
    const gate = createInboundGate(ref);
    h.ingest.parse.mockReturnValue({ ...h.message, jsonLdBlocks: [] });
    const project: DaemonOptions["project"] = async (proposal) => {
      // This is the signer captured by createOutboxProjector in the Phase 3 composition.
      const release = await gate.release(proposal);
      expect(release).toEqual({ ok: false, reason: "unsupported-operation" });
      expect(h.ledger.entries().at(-1)?.record).toMatchObject({
        type: "gate-decision",
        direction: "out",
        outcome: "stop",
        reason: "unsupported-operation",
      });
      throw new ProposalRefusedError("unsupported-operation");
    };
    const options = { ...h.options, gate, project, isFlagged: async () => true };
    if (mode === "interrupted") {
      const { append } = h.options.audit;
      let interrupted = false;
      h.options.audit.append = async (record, at) => {
        if (record.type === "gate-decision" && record.direction === "out" && !interrupted) {
          interrupted = true;
          throw new Error("Release audit unavailable");
        }
        return append(record, at);
      };
      await expect(createDaemon(options).once()).rejects.toThrow("Release audit unavailable");
      expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
      expect(h.state.cursors.size).toBe(0);
      await createDaemon({ ...options, accounts: [], gate: createInboundGate(ref) }).once();
      const decisions = h.ledger
        .entries()
        .filter(({ record }) => record.type === "gate-decision" && record.direction === "out");
      expect(decisions.map(({ record }) => record)).toMatchObject([
        { outcome: "stop", reason: "unsupported-operation", taskId: expect.any(String) },
      ]);
    } else {
      await createDaemon(options).once();
    }
    expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("runs the connectors job once under the process lease before releasing it", async () => {
  const h = harness();
  const tick = vi.fn(async (signal?: AbortSignal) => {
    expect(h.state.held()).toBe(true);
    expect(signal?.aborted).toBe(false);
  });
  const connectors = { tick, run: vi.fn(), list: vi.fn() };
  await createDaemon({ ...h.options, accounts: [], connectors }).once();
  expect(tick).toHaveBeenCalledOnce();
  expect(connectors.run).not.toHaveBeenCalled();
  expect(h.state.held()).toBe(false);
});
it("runs the once-mode connectors pass after ingest and the outbox, bounded by the run limit", async () => {
  vi.useFakeTimers({ now: AT });
  const h = harness(),
    order: string[] = [];
  h.ingest.list.mockImplementation(async () => {
    order.push("ingest");
    return { items: [], next: "one" };
  });
  h.executor.runOutboxOnce.mockImplementation(async () => {
    order.push("outbox");
    return {};
  });
  let passSignal: AbortSignal | undefined;
  // A connector pass that never finishes on its own (e.g. a hung provider).
  const hung = () =>
    vi.fn(async (signal?: AbortSignal) => {
      order.push("connectors");
      passSignal = signal;
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
  const connectors = {
    tick: hung(),
    run: vi.fn(),
    list: vi.fn(),
    runTimeoutMs: 120_000,
  };
  let done = false;
  const pass = createDaemon({ ...h.options, now: Date.now, connectors })
    .once()
    .then(() => {
      done = true;
    });
  await vi.advanceTimersByTimeAsync(0);
  // Approved outbox items are sent before any connector traffic.
  expect(order).toEqual(["ingest", "outbox", "connectors"]);
  expect(h.state.held()).toBe(true);
  await vi.advanceTimersByTimeAsync(119_000);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  await pass;
  expect(passSignal?.aborted).toBe(true);
  expect(h.state.held()).toBe(false);
  // Without a job-specific limit the default run limit applies.
  const other = harness(),
    defaulted = { ...connectors, runTimeoutMs: undefined, tick: hung() };
  let finished = false;
  const second = createDaemon({ ...other.options, now: Date.now, connectors: defaulted })
    .once()
    .then(() => {
      finished = true;
    });
  await vi.advanceTimersByTimeAsync(DEFAULT_CONNECTOR_RUN_TIMEOUT_MS - 1_000);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1_000);
  await second;
  expect(defaulted.tick).toHaveBeenCalledOnce();
});
it("aborts and drains background connectors before executor drain and lease release", async () => {
  const h = harness(),
    controller = new AbortController(),
    order: string[] = [];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const connectors = {
    tick: vi.fn(),
    list: vi.fn(),
    run: async (signal: AbortSignal) => {
      started();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      expect(h.state.held()).toBe(true);
      order.push("connectors");
    },
  };
  h.executor.drain.mockImplementation(async () => {
    order.push("executor");
  });
  const run = createDaemon({ ...h.options, accounts: [], connectors }).run(controller.signal);
  await ready;
  controller.abort();
  await run;
  expect(order).toEqual(["connectors", "executor"]);
  expect(h.state.held()).toBe(false);
});

it("keeps ingesting when the connectors job fails in once mode and logs only a fixed message", async () => {
  const h = harness(),
    log = vi.fn();
  const connectors = {
    tick: vi.fn(async () => {
      throw new Error("token=secret https://private.example");
    }),
    run: vi.fn(),
    list: vi.fn(),
  };
  await createDaemon({ ...h.options, accounts: [], connectors, log }).once();
  expect(connectors.tick).toHaveBeenCalledOnce();
  expect(h.executor.runOutboxOnce).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith("Connectors pass failed");
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private/);
  expect(h.state.held()).toBe(false);
});
it("never faults the run loop when the background connectors job rejects", async () => {
  const h = harness(),
    controller = new AbortController(),
    log = vi.fn();
  const connectors = {
    tick: vi.fn(),
    list: vi.fn(),
    run: vi.fn(async () => {
      throw new Error("secret");
    }),
  };
  const run = createDaemon({ ...h.options, accounts: [], connectors, log }).run(controller.signal);
  await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Connectors pass failed"));
  await vi.waitFor(() => expect(h.executor.runOutboxOnce).toHaveBeenCalled());
  controller.abort();
  await expect(run).resolves.toBeUndefined();
  expect(h.state.held()).toBe(false);
});
it("awp run/once --connectors asks the lazy composition to opt in and fails closed without a job", async () => {
  const h = harness(),
    close = vi.fn(async () => undefined);
  const daemon = createDaemon({ ...h.options, accounts: [] });
  const job = { list: vi.fn(), tick: vi.fn(), run: vi.fn() };
  const composition = vi.fn(async (request: { connectors: boolean }) => ({
    auth: {} as never,
    daemon,
    ...(request.connectors ? { connectors: job } : {}),
    close,
  }));
  const host = createCliHost({
    daemon: composition,
    local: {} as never,
    ledger: h.ledger,
    accounts: vi.fn(),
    credentials: {} as never,
    openLoginUrl: vi.fn(),
    launchCommand: [],
  });
  const io = { print: vi.fn(), confirm: vi.fn(), signal: new AbortController().signal };
  expect(await runCli(["once"], host, io)).toBe(0);
  expect(composition).toHaveBeenLastCalledWith({ connectors: false });
  expect(await runCli(["once", "--connectors"], host, io)).toBe(0);
  expect(composition).toHaveBeenLastCalledWith({ connectors: true });
  expect(await runCli(["once", "--connector"], host, io)).toBe(2);
  expect(await runCli(["run", "--connectors", "extra"], host, io)).toBe(2);
  composition.mockImplementationOnce(async () => ({ auth: {} as never, daemon, close }));
  const before = h.executor.runOutboxOnce.mock.calls.length;
  expect(await runCli(["once", "--connectors"], host, io)).toBe(1);
  expect(h.executor.runOutboxOnce.mock.calls.length).toBe(before);
  expect(close).toHaveBeenCalledTimes(3);
  const composed = createCliHost({
    daemon,
    local: {} as never,
    ledger: h.ledger,
    accounts: vi.fn(),
    credentials: {} as never,
    openLoginUrl: vi.fn(),
    launchCommand: [],
  });
  expect(await runCli(["once", "--connectors"], composed, io)).toBe(1);
});

it("awp connectors uses a lazy composed job and closes its pod session without running the daemon", async () => {
  const h = harness(),
    close = vi.fn(async () => undefined),
    list = vi.fn(async () => []);
  const daemon = createDaemon({ ...h.options, accounts: [] });
  const composition = vi.fn(async () => ({
    auth: {} as never,
    daemon,
    connectors: { list, tick: vi.fn(), run: vi.fn() },
    close,
  }));
  const host = createCliHost({
    daemon: composition,
    local: {} as never,
    ledger: h.ledger,
    accounts: vi.fn(),
    credentials: {} as never,
    openLoginUrl: vi.fn(),
    launchCommand: [],
  });
  expect(composition).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  expect(await runCli(["connectors"], host, { print: vi.fn(), confirm: vi.fn(), signal })).toBe(0);
  expect(list).toHaveBeenCalledWith(signal);
  expect(composition).toHaveBeenCalledWith({ connectors: true });
  expect(close).toHaveBeenCalledOnce();
  expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
});
