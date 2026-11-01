// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { AuditWriter, auditArtifact, MemoryLedger, PodMirror } from "@jeswr/agent-audit";
import { type BridgeMessage, ChannelParseError, DIRECT } from "@jeswr/agent-channels";
import { createDirectReader } from "@jeswr/agent-channels/direct";
import { RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import {
  type ApprovalContext,
  createExecutor,
  type OutboxEntry,
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
import { canonicalJson, digestBytes, digestOf, newUrn, recordFromTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { createGateway, GatewayError } from "@jeswr/agent-model-gateway";
import type { ChangeEvent, NotificationsClient, Subscription } from "@jeswr/pod-notifications";
import {
  buildBitstringStatusListCredential,
  createWebIdKeyResolver,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
import { mkdtemp, rm } from "fs/promises";
import { Server } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import { createDaemon, pollInterval } from "../src/daemon.js";
import { createLocalState } from "../src/local.js";
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
    proposalWritten: async (proposal) => {
      const renderable: OutboxEntry["renderable"] = {
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
      };
      const bytes = canonicalJson(renderable);
      const wire = { bytes, digest: digestBytes(bytes), mediaType: "application/json" };
      const entry: OutboxEntry = {
        proposal: {
          ...proposal,
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
    const project = vi.fn(h.options.proposalWritten);
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
    await expect(
      createDaemon({ ...h.options, ...local, proposalWritten: project }).once(),
    ).rejects.toThrow();
    expect(await local.checkpoints.get("fixture")).toBeUndefined();
    expect(h.executor.runOutboxOnce).not.toHaveBeenCalled();
    const before = [...h.pod.resources].filter(
      ([url]) => url.includes("/proposals/") && url.endsWith(".ttl"),
    );
    // Reopen filesystem state and create a new daemon, as a restarted process would.
    await createDaemon({
      ...h.options,
      ...createLocalState(directory),
      proposalWritten: project,
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
  const project = vi.fn(h.options.proposalWritten);
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
  const options = { ...h.options, proposalWritten: project };
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
  expect(h.ledger.entries().map((entry) => entry.record.type)).toEqual(["ingest"]);
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
  const entry = await h.options.proposalWritten(exampleRecords["action-proposal"]);
  await expect(
    createDaemon({
      ...h.options,
      proposalWritten: async (proposal) => {
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
      proposalWritten: async (proposal) => ({
        ...(await h.options.proposalWritten(proposal)),
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
      proposalWritten: async (proposal) => {
        const entry = await h.options.proposalWritten(proposal);
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
  const project = vi.fn(async (candidate: OutboxEntry["proposal"]) => {
    const entry = { ...outbox, proposal: structuredClone(candidate) };
    entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
    return entry;
  });
  const options = {
    ...h.options,
    proposalWritten: project,
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
    credential: buildBitstringStatusListCredential({
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
        send: { render: async () => wire, validate: async () => ({ ok: true }), transmit },
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
it("proposes only for structured or independently owner-flagged messages", async () => {
  for (const flagged of [false, true]) {
    const h = harness();
    delete (h.message as { jsonLdBlocks?: readonly string[] }).jsonLdBlocks;
    await createDaemon({ ...h.options, isFlagged: vi.fn(async () => flagged) }).once();
    expect(h.options.gateway.proposer.propose).toHaveBeenCalledTimes(flagged ? 1 : 0);
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
