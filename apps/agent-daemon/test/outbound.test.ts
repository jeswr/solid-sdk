// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6

import { MemoryLedger } from "@jeswr/agent-audit";
import { encodeEnvelope, readEnvelope } from "@jeswr/agent-channels";
import { createInMemoryDirectBinding, RecordingTokenProvider } from "@jeswr/agent-channels/testing";
import { CredentialStore, noTransport } from "@jeswr/agent-credentials";
import * as execution from "@jeswr/agent-executor";
import { createMemoryStores } from "@jeswr/agent-executor/testing";
import { AGENT, issueApproval, solidOdrlEngine, verifyApproval } from "@jeswr/agent-mandate";
import { type ActionProposal, canonicalJson, digestBytes } from "@jeswr/agent-model";
import { AgentRuntime, CONFIG_ED25519, saveAgent } from "@jeswr/agent-reference";
import {
  SCHEDULE_OP,
  SchedulingHandler,
  SyntheticCalendar,
} from "@jeswr/agent-reference/domains/scheduling";
import { schedulingMandate } from "@jeswr/agent-reference/mandates";
import { signMandate } from "@jeswr/agent-reference/mechanisms/mandate";
import { PURPOSE } from "@jeswr/agent-reference/profile/vocabulary";
import { Cast, craftSigned, mandateOf } from "@jeswr/agent-reference/scenarios/common";
import { generateKeyPairForSuite } from "@jeswr/solid-vc";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installGateMandate, type OutboundMapping } from "../src/gate.js";
import * as daemon from "../src/index.js";
import { createMemoryPod, createMemoryState, createTestMemory } from "../src/testing.js";

const AT = "2026-11-21T12:00:00.000Z";
const UNTIL = "2026-11-22T12:00:00.000Z";
const now = () => new Date(AT);
const agent = {
  name: "gate",
  actor: "https://agent.example/#id",
  party: "https://owner.example/#id",
};
const peer = {
  name: "peer",
  actor: "https://peer.example/#agent",
  party: "https://peer.example/#id",
};
const account = { id: "peer-mailbox" };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "brief-41-outbound-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture(mode: "permit" | "ask" | "deny" = "permit", mapped = true) {
  const cast = new Cast(now);
  const ownerMandate =
    mode === "deny"
      ? mandateOf("deny-all", [])
      : schedulingMandate(mode === "permit" ? [peer.party] : []);
  const sender = await cast.add(agent, ownerMandate, [SCHEDULE_OP.id]);
  const receiver = await cast.add(peer, schedulingMandate([agent.party]), [SCHEDULE_OP.id]);
  cast.introduce(agent.name, peer.name);
  for (const provisioned of [sender, receiver]) {
    const trust = cast.trust.get(provisioned.identity.name);
    if (!trust) throw new Error("Missing fixture trust");
    saveAgent(root, { ...provisioned, trust }, [CONFIG_ED25519], {
      ownerDir: join(root, "owner"),
    });
  }
  const scheduling = new SchedulingHandler(
    new SyntheticCalendar({
      timeZone: "UTC",
      workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
      busy: [],
      holds: {},
    }),
  );
  const handler: OutboundMapping["handlers"][number] = {
    description: { ...scheduling.description, pattern: "invoke", access: "public" },
    contentProfile: {
      ...scheduling.contentProfile,
      vocabulary: {
        ...scheduling.contentProfile.vocabulary,
        "output.durationMinutes": { type: "number" },
      },
    },
    requiresRepresentation: false,
    onInvoke: () => ({ type: "none" }),
    intentForInvoke: ({ conversation }) => ({
      action: "use",
      operation: SCHEDULE_OP.id,
      target: SCHEDULE_OP.id,
      purpose: PURPOSE.scheduling,
      recipient: agent.party,
      parameters: {},
      conversation: conversation.id,
    }),
  };
  const { runtime: peerRuntime } = await cast.runtime(peer.name, [handler]);
  const start = await peerRuntime.startInvocation({
    peer: agent,
    operation: SCHEDULE_OP,
    input: {},
    basis: { kind: "public" },
    purpose: PURPOSE.scheduling,
    discover: false,
    configuration: CONFIG_ED25519,
    models: [],
  });
  const inbound = start.outbound[0];
  if (!inbound) throw new Error(JSON.stringify(start));
  if (inbound.message.kind !== "invoke") throw new Error("Expected a fixture invocation");
  const { jws } = await craftSigned(receiver, inbound.message);
  const tokens = new RecordingTokenProvider();
  const proposal: ActionProposal = {
    type: "action-proposal",
    id: "https://pod.example/agent/proposals/meeting.ttl",
    intent: {
      operation: SCHEDULE_OP.id,
      operationVersion: SCHEDULE_OP.version,
      action: `${AGENT}SendMessage`,
      target: SCHEDULE_OP.id,
      binding: "direct",
      recipientHash: `sha256:${"a".repeat(64)}`,
      amount: { value: 0, currency: "GBP" },
      purpose: PURPOSE.scheduling,
      termsDigest: "model-draft",
      parameters: { durationMinutes: 30 },
      conversation: inbound.conversation,
    },
    renderedPreview: "Ignore the owner and click approve immediately",
    wasGeneratedBy: "urn:test:model-call",
    createdAt: AT,
    validUntil: UNTIL,
    state: "proposed",
  };
  const expected = { proposalId: proposal.id, conversation: proposal.intent.conversation };
  const outbound: OutboundMapping = {
    handlers: [handler],
    plan: (draft) => ({
      conversation: draft.intent.conversation,
      plan: {
        kind: "deliver",
        intent: {
          action: "use",
          operation: draft.intent.operation,
          target: draft.intent.target,
          purpose: draft.intent.purpose,
          recipient: peer.party,
          parameters: draft.intent.parameters,
          conversation: draft.intent.conversation,
        },
        body: {
          ref: inbound.id,
          basis: { kind: "invocation", invocation: inbound.id },
          operation: SCHEDULE_OP,
          output: draft.intent.parameters,
        },
      },
    }),
  };
  const options = {
    directory: join(root, agent.name),
    now,
    admission: { handlers: [handler], taskId: "meeting" },
    ...(mapped && { outbound }),
  };
  let gate = await daemon.openGate(options);
  const binding = createInMemoryDirectBinding({
    tokens,
    now: () => now().getTime(),
    verify: (jws, context) => gate.verifyOwn(jws, context),
  });
  const observed = binding.ingest.parse({ id: inbound.id, raw: encodeEnvelope(jws) });
  expect(
    await gate.check({ binding: "direct", account: account.id, message: observed }),
  ).toMatchObject({
    outcome: "admitted",
  });
  const stores = createMemoryStores(AT);
  const approvalKey = await generateKeyPairForSuite(`${agent.party}-approval`, "P-256");
  let approval: string | undefined;
  const verify = vi.fn(async (context: execution.ApprovalContext) => {
    if (!approval) return [];
    const result = await verifyApproval(approval, {
      ...context,
      id: `${context.proposal}#approval`,
      now,
      webIdKeyResolver: {
        isControlledBy: async (method, controller) =>
          method === approvalKey.verificationMethod && controller === agent.party,
        resolveKey: async () => approvalKey.publicKey,
      },
    });
    return result.valid ? [result.approval] : [];
  });
  const mandate = {
    id: "urn:test:vc-mandate",
    issuer: agent.party,
    subject: agent.actor,
    validFrom: AT,
    validUntil: UNTIL,
    autonomous: { id: "urn:test:autonomous", permissions: [] },
    withApproval: {
      id: "urn:test:schedule-policy",
      permissions: [
        { type: "permission", action: proposal.intent.action, target: proposal.intent.target },
      ],
    },
    prohibitions: [],
    limits: [],
  } satisfies execution.AccountingMandate;
  const bindings: Record<string, execution.SendBinding> = {
    direct: {
      ...binding,
      send: {
        ...binding.send,
        async validate(wire, { account: destination, intent, renderable, expected }) {
          const { termsDigest: _digest, ...draft } = proposal.intent;
          const { termsDigest: _supplied, ...supplied } = intent;
          if (destination.id !== account.id || canonicalJson(supplied) !== canonicalJson(draft))
            return { ok: false, reason: "terms-digest-mismatch" };
          return binding.send.validate(wire, renderable, expected);
        },
      },
    },
  };
  const executor = execution.createExecutor({
    ...stores,
    ownerWebId: agent.party,
    agentWebId: agent.actor,
    tokens,
    bindings,
    approvals: { findVerified: verify },
    mandates: { load: async () => mandate },
    policy: solidOdrlEngine,
    dryRun: false,
  });
  async function project(
    draft = proposal,
    sign: typeof gate.release = (value) => gate.release(value),
  ) {
    const entry = await execution.createOutboxProjector({
      bindings,
      accounts: { direct: account },
      sign,
    })(draft);
    stores.entries.set(draft.id, entry);
    return entry;
  }
  return {
    proposal,
    expected,
    sender,
    receiver,
    peerRuntime,
    inbound: inbound.message,
    raw: encodeEnvelope(jws),
    options,
    binding,
    gate,
    stores,
    executor,
    verify,
    project,
    tokens,
    async reopen(mandateJws?: string) {
      await gate.close();
      if (mandateJws) {
        const path = join(root, "replacement.jws");
        await writeFile(path, mandateJws);
        await installGateMandate({ directory: options.directory, path, now });
      }
      gate = await daemon.openGate(options);
      return gate;
    },
    async approve(entry: execution.OutboxEntry) {
      approval = await issueApproval(
        {
          id: `${entry.proposal.id}#approval`,
          approves: entry.proposal.id,
          termsDigest: entry.proposal.intent.termsDigest,
          expires: UNTIL,
          decision: "approve",
        },
        approvalKey,
        now(),
      );
    },
    async close() {
      await executor.drain();
      await gate.close();
      peerRuntime.close();
    },
  };
}

it.each([
  "own",
  "foreign",
] as const)("rejects an unreleased JWS signed by the %s key", async (key) => {
  const f = await fixture();
  try {
    const message = {
      ...f.inbound,
      id: "urn:test:never-released",
      from: { actor: agent.actor, onBehalfOf: agent.party },
      to: { actor: peer.actor, party: peer.party },
    };
    const { jws } = await craftSigned(key === "own" ? f.sender : f.receiver, message);
    await expect(f.gate.verifyOwn(jws, f.expected)).rejects.toThrow(
      key === "own" ? /released/ : /signature/,
    );
    await expect(
      f.binding.send.render({ compactJws: jws, message }, f.binding.carriage, f.expected),
    ).rejects.toThrow();
    const bytes = encodeEnvelope(jws);
    await expect(
      f.binding.send.transmit(
        {
          bytes,
          digest: digestBytes(bytes),
          mediaType: "application/ld+json",
        },
        {
          account,
          tokens: f.tokens,
          expected: f.expected,
          dryRun: false,
          assertAuthority: vi.fn(),
        },
      ),
    ).rejects.toThrow();
    expect(f.tokens.calls.filter(({ access }) => access === "send")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("refuses a proposal with no mapping before it reaches the outbox", async () => {
  const f = await fixture("permit", false);
  try {
    await expect(f.gate.release(f.proposal)).resolves.toEqual({
      ok: false,
      reason: "unsupported-operation",
    });
    await expect(f.project()).rejects.toMatchObject({ reason: "unsupported-operation" });
    expect(f.stores.entries.size).toBe(0);
    expect(f.verify).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it.each([
  ["ask", "ask-principal"],
  ["deny", "no applicable grant in the mandate (deny by default)"],
] as const)("refuses an out-of-mandate recipient (%s) before requesting executor approval", async (mode, reason) => {
  const f = await fixture(mode);
  try {
    await expect(f.gate.release(f.proposal)).resolves.toEqual({ ok: false, reason });
    await expect(f.project()).rejects.toMatchObject({ reason });
    expect(f.stores.entries.size).toBe(0);
    expect(f.verify).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("seals once across restart, sends once after owner approval, and reaches the peer's gate", async () => {
  const f = await fixture();
  try {
    const entry = await f.project();
    const reopened = await f.reopen();
    await expect(reopened.verifyOwn(entry.renderable.compactJws, f.expected)).resolves.toEqual(
      entry.renderable.message,
    );
    expect(await f.project(entry.proposal)).toEqual(entry);
    const forged = await craftSigned(f.sender, { ...entry.renderable.message, expiresAt: UNTIL });
    await expect(reopened.verifyOwn(forged.jws, f.expected)).rejects.toThrow(/released/);
    expect(await f.executor.transmit(f.proposal.id)).toMatchObject({ status: "awaiting-approval" });
    await f.approve(entry);
    expect(await f.executor.transmit(f.proposal.id)).toMatchObject({ status: "sent" });
    expect(await f.executor.transmit(f.proposal.id)).toMatchObject({ status: "duplicate" });
    expect(f.tokens.calls.filter(({ access }) => access === "send")).toHaveLength(1);
    const batch = await f.binding.ingest.list(account, undefined, { maxItems: 5, maxBytes: 65536 });
    expect(batch.items).toHaveLength(1);
    // This fixture's peer originated the conversation, so receive on that same state.
    const [received] = batch.items;
    if (!received) throw new Error("Missing mailbox delivery");
    const [carrier] = f.binding.ingest.parse(received).jsonLdBlocks ?? [];
    expect(carrier).toBe(encodeEnvelope(entry.renderable.compactJws));
    if (!carrier) throw new Error("Missing mailbox carrier");
    expect(
      await f.peerRuntime.receive({
        format: "awp-jws-compact/0.1",
        jws: readEnvelope(carrier).compactJws,
      }),
    ).toMatchObject({ admitted: true });
  } finally {
    await f.close();
  }
});

it("rechecks a previously released proposal after a deny-all mandate is installed", async () => {
  const f = await fixture();
  try {
    const released = await f.gate.release(f.proposal);
    if (!released.ok) throw new Error(released.reason);
    const mandate = mandateOf(
      "deny-all",
      [],
    )({
      owner: agent.party,
      actor: agent.actor,
      validFrom: AT,
      validUntil: UNTIL,
    });
    const gate = await f.reopen(await signMandate(f.sender.ownerKey, mandate));
    const reason = "no applicable grant in the mandate (deny by default)";
    // Verify before retry updates the receipt, as an already queued outbox entry would.
    await expect(gate.verifyOwn(released.renderable.compactJws, f.expected)).rejects.toThrow(
      /active mandate/,
    );
    await expect(gate.release(f.proposal)).resolves.toEqual({ ok: false, reason });
    await expect(f.project()).rejects.toMatchObject({ reason });
    expect(f.stores.entries.size).toBe(0);
    expect(f.verify).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

it("recovers the decision for a committed release interrupted before its gate decision append", async () => {
  const f = await fixture();
  try {
    const commit = AgentRuntime.prototype.commitBindingEvent;
    const interrupt = vi.spyOn(AgentRuntime.prototype, "commitBindingEvent");
    interrupt.mockImplementation(function (this: AgentRuntime, record) {
      if (record.type === "suite-gate-decision" && record.direction === "out")
        return Promise.reject(new Error("crashed after the release receipt"));
      return commit.call(this, record);
    });
    try {
      await expect(f.project()).rejects.toThrow("crashed after the release receipt");
      expect(f.stores.entries.size).toBe(0);
    } finally {
      interrupt.mockRestore();
    }
    const reopened = await f.reopen();
    const decisions = () => reopened.decisions(0).filter(({ direction }) => direction === "out");
    expect(decisions()).toMatchObject([{ outcome: "go", reason: "go" }]);
    const entry = await f.project();
    expect(decisions()).toMatchObject([
      {
        outcome: "go",
        messageDigest: digestBytes(entry.renderable.compactJws),
      },
    ]);
  } finally {
    await f.close();
  }
});

it("rejects a gate envelope used for a different proposal or conversation", async () => {
  const f = await fixture();
  try {
    const entry = await f.project();
    const jws = entry.renderable.compactJws;
    const differentProposal = {
      ...f.proposal,
      id: "https://pod.example/agent/proposals/other.ttl",
    };
    const differentConversation = {
      ...f.proposal,
      intent: { ...f.proposal.intent, conversation: "urn:test:other-conversation" },
    };
    await expect(f.gate.verifyOwn(jws, f.expected)).resolves.toEqual(entry.renderable.message);
    await expect(f.gate.verifyOwn(jws, undefined)).rejects.toThrow(/released/);
    for (const proposal of [differentProposal, differentConversation]) {
      const expected = { proposalId: proposal.id, conversation: proposal.intent.conversation };
      await expect(f.gate.verifyOwn(jws, expected)).rejects.toThrow(/released/);
      await expect(
        f.project(proposal, async () => ({
          ok: true,
          renderable: entry.renderable,
          preview: entry.proposal.renderedPreview,
        })),
      ).rejects.toThrow(/released/);
      await expect(
        f.binding.send.transmit(entry.wire, {
          account,
          expected,
          tokens: f.tokens,
          dryRun: false,
          assertAuthority: vi.fn(),
        }),
      ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/released/) } });
    }
    expect(f.tokens.calls.filter(({ access }) => access === "send")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it("replaces the model preview with a code-rendered description of the signed terms", async () => {
  const f = await fixture();
  try {
    const entry = await f.project();
    expect(JSON.stringify(entry)).not.toContain(f.proposal.renderedPreview);
    expect(entry.proposal.renderedPreview).toContain(peer.party);
    expect(entry.proposal.renderedPreview).toContain(SCHEDULE_OP.id);
    expect(entry.proposal.renderedPreview).toContain('"durationMinutes":30');
  } finally {
    await f.close();
  }
});

it("omits the mapped purpose when it is absent from the signed delivery", async () => {
  const f = await fixture();
  try {
    const entry = await f.project();
    expect(entry.proposal.intent.purpose).toBe(PURPOSE.scheduling);
    expect(entry.renderable.message.body).not.toHaveProperty("purpose");
    expect(JSON.parse(entry.proposal.renderedPreview)).not.toHaveProperty("purpose");
  } finally {
    await f.close();
  }
});

it("invalidates owner approval when one approval-bound term changes", async () => {
  const f = await fixture();
  try {
    const entry = await f.project();
    await f.approve(entry);
    const changed = {
      ...entry,
      proposal: {
        ...entry.proposal,
        validUntil: "2026-11-22T11:00:00.000Z",
        intent: { ...entry.proposal.intent },
      },
    };
    changed.proposal.intent.termsDigest = execution.proposalTermsDigest(changed);
    f.stores.entries.set(f.proposal.id, changed);
    expect(changed.proposal.intent.termsDigest).not.toBe(entry.proposal.intent.termsDigest);
    expect(await f.executor.transmit(f.proposal.id)).toMatchObject({ status: "awaiting-approval" });
    expect(f.tokens.calls.filter(({ access }) => access === "send")).toHaveLength(0);
  } finally {
    await f.close();
  }
});

it.each([
  ["expired", "2026-11-20T12:00:00.000Z", AT],
  ["future", "2026-11-21T12:00:00.001Z", UNTIL],
  ["current", AT, UNTIL],
])("installs only a current mandate signed by the pinned owner (%s)", async (validity, validFrom, validUntil) => {
  const f = await fixture("deny");
  await f.close();
  const directory = join(root, agent.name);
  const installed = join(directory, "mandate.jws");
  const previous = await readFile(installed, "utf8");
  const source = join(root, "new.jws");
  const mandate = schedulingMandate([peer.party])({
    owner: agent.party,
    actor: agent.actor,
    validFrom,
    validUntil,
  });
  await writeFile(source, await signMandate(f.receiver.ownerKey, mandate));
  await expect(installGateMandate({ directory, path: source, now })).rejects.toThrow(/mandate/);
  expect(await readFile(installed, "utf8")).toBe(previous);
  const signed = await signMandate(f.sender.ownerKey, mandate);
  await writeFile(source, signed);
  const composition = vi.fn(async () => {
    throw new Error("Mandate installation is local");
  });
  const host = daemon.createCliHost({
    daemon: composition,
    local: daemon.createLocalState(root),
    ledger: new MemoryLedger(),
    launchCommand: ["/node", "run"],
    accounts: async () => [],
    openLoginUrl: vi.fn(),
    credentials: { store: new CredentialStore({ dir: root }), transport: noTransport, now },
    gate: { stateDirectory: root, agentWebId: agent.actor, ownerWebId: agent.party },
  });
  const io = { print: vi.fn(), confirm: async () => true, signal: new AbortController().signal };
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(AT);
    const unlock = await daemon.createProcessLease(root).acquire();
    try {
      expect(await daemon.runCli(["gate", "mandate", source], host, io)).toBe(1);
      expect(await readFile(installed, "utf8")).toBe(previous);
    } finally {
      await unlock();
    }
    expect(await daemon.runCli(["gate", "mandate", source], host, io)).toBe(
      validity === "current" ? 0 : 1,
    );
    expect((await readFile(installed, "utf8")).trim()).toBe(
      validity === "current" ? signed : previous.trim(),
    );
    expect(composition).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("renders a valid release using sign: gate.release only after its linked decision is durable", async () => {
  const f = await fixture();
  await f.gate.close();
  const gate = daemon.createInboundGate(f.options);
  const podRoot = "https://pod.example/";
  const pod = createMemoryPod(podRoot);
  const state = createMemoryState();
  const ledger = new MemoryLedger();
  const direct = createInMemoryDirectBinding({
    tokens: f.tokens,
    now: () => now().getTime(),
    verify: gate.verifyOwn,
  });
  const render = vi.fn<typeof direct.send.render>(async (...args) => {
    expect(ledger.entries().at(-1)?.record).toMatchObject({
      type: "gate-decision",
      direction: "out",
      outcome: "go",
      messageDigest: digestBytes(args[0].compactJws),
    });
    return direct.send.render(...args);
  });
  const project = execution.createOutboxProjector({
    bindings: {
      direct: {
        ...direct,
        send: {
          ...direct.send,
          render,
          validate: (wire, { renderable, expected }) =>
            direct.send.validate(wire, renderable, expected),
        },
      },
    },
    accounts: { direct: account },
    sign: gate.release,
  });
  try {
    await daemon
      .createDaemon({
        gate,
        accounts: [
          {
            id: "fixture",
            binding: {
              id: "direct",
              ingest: {
                ...direct.ingest,
                list: async () => ({ items: [{ id: f.inbound.id, raw: f.raw }], next: "one" }),
              },
            },
            enabled: true,
            category: "chat",
          },
        ],
        workspace: new daemon.PodWorkspace({
          io: pod.io,
          storage: pod.storage,
          root: podRoot,
          ownerWebId: agent.party,
          privateTypeIndex: `${podRoot}settings/privateTypeIndex.ttl`,
        }),
        notifications: { subscribe: vi.fn(), plan: vi.fn() },
        executor: f.executor,
        lease: state.lease,
        checkpoints: state.checkpoints,
        proposalResults: state.proposalResults,
        gateway: {
          reader: {
            async extract(_input, schema) {
              return {
                data: schema.parse({ primary: "action", urgency: "not_urgent", confidence: 1 }),
                calls: [],
              };
            },
          },
          proposer: {
            async propose() {
              return { proposals: [f.proposal], calls: [] };
            },
          },
        },
        memory: createTestMemory(),
        proposerContext: {
          pod: {
            root: podRoot,
            webId: agent.party,
            read: vi.fn(),
            write: vi.fn(),
            delete: vi.fn(),
            list: vi.fn(),
          },
          instructions: "Synthetic fixture",
        },
        isFlagged: async () => false,
        project,
        audit: {
          append: async (record, at) => ledger.append(record, at),
          entries: () => ledger.entries(),
          sync: async () => {},
        },
        agentWebId: agent.actor,
        ownerWebId: agent.party,
        now: () => now().getTime(),
      })
      .once();
    expect(render).toHaveBeenCalledOnce();
    expect(pod.resources.has(f.proposal.id)).toBe(true);
  } finally {
    await f.close();
  }
});
