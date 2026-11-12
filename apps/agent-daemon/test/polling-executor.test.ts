// AUTHORED-BY Codex GPT-6.1-Sol
import { MemoryLedger } from "@jeswr/agent-audit";
import {
  createExecutor,
  type OutboxEntry,
  proposalTermsDigest,
  type SendBinding,
} from "@jeswr/agent-executor";
import { createMemoryStores } from "@jeswr/agent-executor/testing";
import { AGENT, solidOdrlEngine } from "@jeswr/agent-mandate";
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemon } from "../src/daemon.js";
import { createMemoryPod, createMemoryState } from "../src/testing.js";
import { PodWorkspace } from "../src/workspace.js";

afterEach(() => vi.useRealTimers());
it("fences the real executor's suspended send grant on a halt discovered by the 30-second fallback", async () => {
  const at = "2026-11-01T12:00:00.000Z";
  const until = "2026-12-31T12:00:00.000Z";
  vi.useFakeTimers({ now: Date.parse(at) });
  const root = "https://pod.example/";
  const owner = `${root}profile#me`;
  const agent = `${root}agent#me`;
  const stores = createMemoryStores(at);
  const state = createMemoryState();
  const pod = createMemoryPod();
  const workspace = new PodWorkspace({
    io: pod.io,
    storage: pod.storage,
    root,
    ownerWebId: owner,
    privateTypeIndex: `${root}privateTypeIndex.ttl`,
  });
  const renderable: OutboxEntry["renderable"] = {
    compactJws: "fixture.signed.message",
    message: {
      id: "urn:message:fixture",
      profile: "urn:profile:fixture",
      configuration: "urn:config:fixture",
      conversation: "urn:conversation:fixture",
      kind: "invoke",
      from: { actor: agent },
      createdAt: at,
      expiresAt: until,
      body: {
        operation: { id: "urn:operation:send", version: "1" },
        input: {},
        basis: { kind: "public" },
      },
    },
  };
  const bytes = canonicalJson(renderable);
  const entry: OutboxEntry = {
    renderable,
    account: { id: "fixture" },
    wireDigest: digestBytes(bytes),
    wire: { bytes, mediaType: "application/json", digest: digestBytes(bytes) },
    proposal: {
      type: "action-proposal",
      id: `${root}agent/proposals/fixture.ttl`,
      renderedPreview: "Fixture",
      wasGeneratedBy: "urn:activity:fixture",
      createdAt: at,
      validUntil: until,
      state: "proposed",
      intent: {
        operation: "urn:operation:send",
        operationVersion: "1",
        action: `${AGENT}SendMessage`,
        target: "urn:target:fixture",
        binding: "direct",
        recipientHash: "sha256:fixture",
        amount: { value: 0, currency: "GBP" },
        purpose: "urn:purpose:fixture",
        termsDigest: "placeholder",
        parameters: {},
        conversation: "urn:conversation:fixture",
      },
    },
  };
  (entry.proposal.intent as { termsDigest: string }).termsDigest = proposalTermsDigest(entry);
  stores.entries.set(entry.proposal.id, entry);
  const providerEffect = vi.fn();
  let releaseToken!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseToken = resolve;
  });
  const tokens = {
    send: vi.fn(async () => {
      await waiting;
      return { access: "send" as const, accessToken: "synthetic-fixture" };
    }),
  };
  const binding: SendBinding = {
    id: "direct",
    carriage: { id: "fixture", structured: "native", footer: "none", maxBytes: 65536 },
    send: {
      render: async () => entry.wire,
      validate: async () => ({ ok: true }),
      transmit: async (_wire, io) => {
        await io.tokens.send(io.account);
        providerEffect();
        return { outcome: "accepted", providerRef: "fixture" };
      },
    },
  };
  const executor = createExecutor({
    ownerWebId: owner,
    agentWebId: agent,
    proposals: stores.proposals,
    approvals: stores.approvalStore,
    controls: stores.controls,
    transmissions: stores.transmissions,
    audit: stores.audit,
    clock: { now: () => new Date() },
    tokens,
    bindings: { direct: binding },
    dryRun: false,
    timeoutMs: 120000,
    policy: solidOdrlEngine,
    mandates: {
      load: async () => ({
        id: "urn:mandate:fixture",
        issuer: owner,
        subject: agent,
        validFrom: at,
        validUntil: until,
        autonomous: {
          id: "urn:autonomous",
          permissions: [{ type: "permission", action: `${AGENT}SendMessage` }],
        },
        withApproval: { id: "urn:approval", permissions: [] },
        prohibitions: [],
        limits: [],
      }),
    },
  });
  const invalidate = vi.spyOn(executor, "onControlOrMandateChange");
  const ledger = new MemoryLedger();
  const controller = new AbortController();
  const run = createDaemon({
    workspace,
    accounts: [],
    lease: state.lease,
    checkpoints: state.checkpoints,
    proposalResults: state.proposalResults,
    executor,
    notifications: {
      subscribe: async () => {
        throw new Error("No push");
      },
      plan: () => ({ channel: "poll", reason: "fixture" }),
    },
    ownerWebId: owner,
    agentWebId: agent,
    audit: {
      append: async (record, time) => ledger.append(record, time),
      entries: () => ledger.entries(),
      sync: async () => undefined,
    },
    proposalWritten: vi.fn(),
    gateway: { reader: { extract: vi.fn() }, proposer: { propose: vi.fn() } },
    proposerContext: {
      instructions: "fixture",
      memoryRecall: async () => [],
      pod: { root, webId: owner, read: vi.fn(), list: vi.fn(), write: vi.fn(), delete: vi.fn() },
    },
    isFlagged: async () => false,
  }).run(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(tokens.send).toHaveBeenCalledOnce();
  // The adapter supplies verified statements; the CSS integration exercises real proof verification.
  stores.statements.push({
    type: "control-statement",
    id: "urn:control:halt",
    kind: "Halt",
    attributedTo: owner,
    createdAt: at,
    expires: until,
  });
  await vi.advanceTimersByTimeAsync(30000);
  expect(invalidate).toHaveBeenCalledTimes(2);
  controller.abort();
  releaseToken();
  await run;
  expect(providerEffect).not.toHaveBeenCalled();
  expect(state.held()).toBe(false);
});
