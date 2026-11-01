// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { MemoryLedger } from "@jeswr/agent-audit";
import { type BridgeMessage, ChannelParseError } from "@jeswr/agent-channels";
import { digestBytes, digestOf } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { createGateway, GatewayError } from "@jeswr/agent-model-gateway";
import type { ChangeEvent, NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import { Server } from "net";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemon, pollInterval } from "../src/daemon.js";
import { createMemoryPod, createMemoryState } from "../src/testing.js";
import type { DaemonOptions } from "../src/types.js";
import { PodWorkspace } from "../src/workspace.js";

export const ROOT = "https://pod.example/";
export const OWNER = `${ROOT}profile/card#me`;
export const AGENT_ID = `${ROOT}profile/agent#me`;
export const AT = Date.parse("2026-11-01T12:00:00.000Z");
function harness() {
  const pod = createMemoryPod();
  const workspace = new PodWorkspace({
    io: pod.io,
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
    parse: vi.fn(() => message),
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
  const options: DaemonOptions = {
    workspace,
    notifications,
    executor,
    lease: state.lease,
    checkpoints: state.checkpoints,
    accounts: [
      { id: "fixture", binding: { id: "direct", ingest }, category: "chat", enabled: true },
    ],
    ownerWebId: OWNER,
    agentWebId: AGENT_ID,
    audit: { append: async (r, at) => ledger.append(r, at) },
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
    proposerContext: {
      pod: {
        root: ROOT,
        webId: OWNER,
        read: vi.fn(),
        write: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      },
      memoryRecall: async () => [],
      instructions: "Synthetic fixture",
    },
    isFlagged: vi.fn(async () => false),
    now: () => AT,
  };
  return {
    pod,
    workspace,
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
  expect(h.ledger.entries().map((e) => e.record.type)).toEqual(["ingest", "proposal"]);
  expect(h.state.held()).toBe(false);
  expect([...h.pod.resources.keys()].some((url) => url.includes("agent/proposals/"))).toBe(true);
});
it("proposes only for structured or independently owner-flagged messages", async () => {
  for (const flagged of [false, true]) {
    const h = harness();
    delete (h.message as { jsonLdBlocks?: readonly string[] }).jsonLdBlocks;
    await createDaemon({ ...h.options, isFlagged: vi.fn(async () => flagged) }).once();
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledTimes(flagged ? 1 : 0);
  }
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
it("skips a malformed message but fails a binding that exceeds the ingest bound", async () => {
  const h = harness();
  h.ingest.parse.mockImplementationOnce(() => {
    throw new ChannelParseError("fixture");
  });
  await createDaemon(h.options).once();
  expect(h.options.gateway.proposer.propose).not.toHaveBeenCalled();
  expect(h.state.cursors.get("fixture")).toBe("one");
  await expect(
    createDaemon({ ...h.options, limits: { maxItems: 1, maxBytes: 1 } }).once(),
  ).rejects.toThrow("bound");
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
  const controller = new AbortController();
  const run = createDaemon(options).run(controller.signal);
  await vi.advanceTimersByTimeAsync(300_000);
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
