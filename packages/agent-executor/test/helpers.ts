// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { AGENT, solidOdrlEngine } from "@jeswr/agent-mandate";
import { type ControlStatement, canonicalJson, digestBytes } from "@jeswr/agent-model";
import { vi } from "vitest";
import { createExecutor, proposalTermsDigest } from "../src/index.js";
import { createMemoryStores } from "../src/testing.js";
import type {
  AccountingMandate,
  ExecutorOptions,
  OutboxEntry,
  SendBinding,
  TransmissionRecord,
} from "../src/types.js";
export const OWNER = "https://owner.example/profile#me";
export const AGENT_ID = "https://agent.example/profile#me";
export const NOW = "2026-10-31T12:00:00.000Z";
export const UNTIL = "2026-12-31T12:00:00.000Z";
export function harness(bindingId = "gmail") {
  const stores = createMemoryStores();
  const binding: SendBinding = {
    id: bindingId,
    carriage: { id: "test/1", structured: "native", footer: "none", maxBytes: 65536 },
    send: {
      preview: vi.fn(async (wire) => wire.bytes),
      render: vi.fn(async (p) => {
        const bytes = canonicalJson(p);
        return { bytes, mediaType: "application/json", digest: digestBytes(bytes) };
      }),
      validate: vi.fn(async () => ({ ok: true as const })),
      transmit: vi.fn(async (_wire, io) => {
        if (io.dryRun) return { outcome: "rejected" as const, detail: "dry-run" };
        await io.tokens.send(io.account);
        io.assertAuthority();
        return { outcome: "accepted" as const, providerRef: "test:1" };
      }),
    },
  };
  const state: typeof stores.state & { mandate: AccountingMandate | undefined } = {
    ...stores.state,
    mandate: {
      id: "https://pod.example/agent/mandates/current",
      issuer: OWNER,
      subject: AGENT_ID,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: UNTIL,
      autonomous: {
        id: "urn:autonomous",
        permissions: [{ type: "permission", action: `${AGENT}SendMessage` }],
      },
      withApproval: { id: "urn:approval", permissions: [] },
      prohibitions: [],
      limits: [],
      currency: "GBP",
    },
  };
  Object.defineProperties(state, {
    at: {
      get: () => stores.state.at,
      set: (value: string) => {
        stores.state.at = value;
      },
    },
    haltFile: {
      get: () => stores.state.haltFile,
      set: (value: boolean) => {
        stores.state.haltFile = value;
      },
    },
  });
  const options: ExecutorOptions = {
    ownerWebId: OWNER,
    agentWebId: AGENT_ID,
    proposals: stores.proposals,
    approvals: stores.approvalStore,
    mandates: { load: vi.fn(async () => state.mandate) },
    policy: solidOdrlEngine,
    controls: stores.controls,
    clock: stores.clock,
    tokens: {
      send: vi.fn(async () => ({ access: "send" as const, accessToken: "synthetic-send-only" })),
    },
    bindings: { [bindingId]: binding },
    transmissions: stores.transmissions,
    audit: stores.audit,
    dryRun: false,
  };
  async function enqueue(id = "urn:proposal:1", amount = 0): Promise<OutboxEntry> {
    const renderable: OutboxEntry["renderable"] = {
      compactJws: "synthetic.signed.carrier",
      message: {
        profile: "urn:test:profile",
        configuration: "urn:test:config",
        id,
        conversation: "urn:conversation:1",
        kind: "invoke",
        from: { actor: AGENT_ID },
        createdAt: NOW,
        expiresAt: UNTIL,
        body: {
          operation: { id: "urn:operation:send", version: "1" },
          input: {},
          basis: { kind: "public" },
        },
      },
    };
    const bytes = canonicalJson(renderable);
    const entry: OutboxEntry = {
      proposal: {
        type: "action-proposal",
        id,
        intent: {
          operation: "urn:operation:send",
          operationVersion: "1",
          action: `${AGENT}SendMessage`,
          target: "urn:target:1",
          binding: bindingId,
          recipientHash: "sha256:synthetic-recipient",
          amount: { value: amount, currency: "GBP" },
          purpose: "urn:purpose:reply",
          termsDigest: "placeholder",
          parameters: {},
          conversation: "urn:conversation:1",
        },
        renderedPreview: await binding.send.preview({
          bytes,
          mediaType: "application/json",
          digest: digestBytes(bytes),
        }),
        wasGeneratedBy: "urn:proposer:1",
        createdAt: NOW,
        validUntil: UNTIL,
        state: "proposed",
      },
      renderable,
      account: { id: "urn:account:synthetic" },
      wire: { bytes, mediaType: "application/json", digest: digestBytes(bytes) },
      wireDigest: digestBytes(bytes),
    };
    seal(entry);
    stores.entries.set(id, entry);
    return entry;
  }
  function confirm(entry: OutboxEntry, decision: "approve" | "deny" = "approve") {
    stores.approvals.push({
      id: `urn:approval:${stores.approvals.length}`,
      approves: entry.proposal.id,
      termsDigest: entry.proposal.intent.termsDigest,
      expires: UNTIL,
      decision,
    });
  }
  function needsApproval() {
    const m = state.mandate as AccountingMandate;
    state.mandate = { ...m, autonomous: { id: "urn:autonomous", permissions: [] } };
  }
  function prior(
    entry: OutboxEntry,
    status: TransmissionRecord["status"] = "uncertain",
    attempts = 1,
  ): TransmissionRecord {
    const record: TransmissionRecord = {
      proposal: entry.proposal.id,
      binding: bindingId,
      account: entry.account.id,
      wireDigest: entry.wireDigest,
      termsDigest: entry.proposal.intent.termsDigest,
      status,
      attempts,
      startedAt: NOW,
      committedAt: NOW,
      updatedAt: NOW,
      underMandate: "urn:old-mandate",
      conversation: entry.proposal.intent.conversation,
      recipientHash: entry.proposal.intent.recipientHash,
      amount: entry.proposal.intent.amount,
    };
    stores.records.set(record.proposal, record);
    return record;
  }
  return {
    ...stores,
    options,
    binding,
    state,
    enqueue,
    confirm,
    needsApproval,
    prior,
    executor: createExecutor(options),
  };
}
export function seal(entry: OutboxEntry): void {
  entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function control(
  kind: ControlStatement["kind"],
  offset: number,
  overrides: Partial<ControlStatement> = {},
): ControlStatement {
  return {
    type: "control-statement",
    id: `urn:control:${offset}`,
    kind,
    attributedTo: OWNER,
    createdAt: new Date(Date.parse(NOW) - 10000 + offset).toISOString(),
    expires: UNTIL,
    ...overrides,
  };
}
