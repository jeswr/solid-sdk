// AUTHORED-BY Codex GPT-6
import type { OdrlRule } from "@jeswr/solid-odrl";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import type { GateContext } from "../src/gates/common.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing payment fixture value");
  return value;
}

const task = "urn:task:pay",
  purpose = "urn:purpose:pay",
  op = "urn:op:pay";
async function fixture(action = "pay", canApprove = true, extra: Partial<GateContext> = {}) {
  let time = new Date("2026-11-13T09:00:00.000Z");
  const now = () => time;
  const cast = new Cast(now);
  const r = {
    id: "urn:rule:spend",
    type: "permission",
    action,
    target: op,
    ...(action === "pay"
      ? { limit: { perAction: 500, perPeriod: 2000, period: "calendar-month", currency: "GBP" } }
      : {}),
  } as unknown as OdrlRule;
  const p = await cast.add(
    { name: "payer", actor: "urn:payer:agent", party: "urn:payer" },
    mandateOf(
      "pay",
      [
        r,
        ...(action === "pay"
          ? [
              {
                id: "urn:rule:agree",
                type: "permission",
                action: "use",
                target: "urn:op:paid-service",
              } as OdrlRule,
            ]
          : []),
      ],
      canApprove
        ? [
            {
              id: "urn:rule:approval",
              type: "permission",
              action,
              target: op,
            } as unknown as OdrlRule,
          ]
        : [],
    ),
    [op, "urn:op:paid-service"],
  );
  const service = "urn:op:paid-service";
  const serviceHandler: OperationHandler = {
    description: {
      id: service,
      version: "0.1",
      label: "Agree the payment test service",
      pattern: "negotiate",
      access: "represented",
      roles: ["initiator", "responder"],
      models: [],
      effects: [],
      outcomes: [],
    },
    requiresRepresentation: true,
    contentProfile: {
      identifiers: [purpose],
      vocabulary: {
        "terms.service": { type: "term", values: ["Test service"] },
        "terms.compensation.amount": { type: "term", values: ["500", "501", "600"] },
        "terms.compensation.currency": { type: "code", values: ["GBP"] },
        "terms.compensation.payee": { type: "identifier" },
        "terms.invoice": { type: "identifier" },
        "terms.validFrom": { type: "date" },
        "terms.validUntil": { type: "date" },
        "terms.purpose": { type: "identifier" },
      },
    },
    intentForProposal: (ctx) => ({
      action: "use",
      operation: service,
      target: service,
      recipient: ctx.peer.party,
      purpose,
      conversation: ctx.conversation.id,
      parameters: {},
    }),
    onProposal: (ctx) => ({
      type: "accept",
      intent: {
        action: "use",
        operation: service,
        target: service,
        recipient: ctx.peer.party,
        purpose,
        conversation: ctx.conversation.id,
        parameters: {},
      },
    }),
    onAgreement: (ctx, agreement, role) => ({
      requiredOutcomes: [],
      ...(role === "offeror"
        ? {
            messages: [
              {
                kind: "receipt",
                body: {
                  ref: required(ctx.message).id,
                  activity: agreement.id,
                  outcome: "completed",
                  final: false,
                },
              },
            ],
          }
        : {}),
    }),
    onReceipt: () => ({ type: "none" }),
  };
  if (action === "pay") {
    await cast.add(
      { name: "payee", actor: "urn:payee:agent", party: "urn:payee" },
      mandateOf("payee", [
        { id: "urn:rule:offer", type: "permission", action: "use", target: service },
      ]),
      [service],
    );
    cast.introduce("payer", "payee");
  }
  const issuer = await testKey("durable/bank");
  cast.pinIssuer("payer", "urn:bank", issuer);
  cast.rule("payer", {
    id: "urn:rule:bank",
    version: "1",
    source: "urn:bank",
    claimTypes: ["payee-account"],
    subjects: "any",
  });
  let store: StateStore = new MemoryStateStore();
  const ledger = new MemoryLedger(),
    recorder = new TraceRecorder();
  let effects = 0;
  const gates: GateContext = {
    configuration: BASELINE,
    sink: recorder.sink("payer"),
    taskId: task,
    purposes: { [purpose]: ["payee-account"] },
    reliance: {
      id: "urn:rule:quality",
      rules: [
        {
          id: "urn:rule:account",
          claimType: "payee-account",
          methods: ["recorded-by-authority"],
          maxAgeDays: 100,
          text: "Fictional account confirmations",
        },
      ],
    },
    ...extra,
  };
  // Each restart loads the same independently provisioned anchors.
  const make = async () => {
    const rtOptions = {
      identity: { actor: p.identity.actor, party: p.identity.party },
      actorKeys: [p.actorKey],
      trust: await TrustStore.load(cast.trust.get("payer")),
      mandateJws: p.mandateJws,
      representationJws: p.representationJws,
      accepted: [CONFIG_ED25519],
      handlers: action === "pay" ? [serviceHandler] : [],
      store,
      ledger,
      now,
      gates,
      effects: [
        {
          id: "urn:adapter:bank",
          execute: async () => {
            expect(Object.keys(store.load().paymentReleases).length).toBeGreaterThanOrEqual(
              action === "pay" ? effects + 1 : 0,
            );
            effects++;
            return { conclusion: "completed" as const, observed: { submitted: true } };
          },
          reconcile: async () => ({ conclusion: "not-executed" as const, reason: "not executed" }),
        },
      ],
    };
    return AgentRuntime.create(rtOptions);
  };
  const rt = await make();
  await rt.admitStatements(
    [
      {
        jws: await signClaim(issuer, {
          id: "urn:account:binding",
          issuer: "urn:bank",
          subject: "urn:payee",
          claimType: "payee-account",
          method: "recorded-by-authority",
          asOf: now().toISOString(),
          payee: "urn:payee",
          account: "urn:account:payee",
          reference: "urn:invoice",
          validUntil: "2027-01-01T00:00:00.000Z",
          terms: {
            policy: {
              id: "urn:terms:payee-binding",
              permissions: [
                { type: "permission", action: "use", target: "urn:account:binding" },
                { type: "permission", action: "distribute", target: "urn:account:binding" },
              ],
            },
          },
        }),
      },
    ],
    { task, taskId: task, purpose },
  );
  const supplier =
    action === "pay" ? (await cast.runtime("payee", [serviceHandler])).runtime : undefined;
  const agreements = new Map<string, { digest: string; invoice: string }>();
  const pay = async (runtime: AgentRuntime, key: string, amount = 500, reuse?: string) => {
    let held = agreements.get(reuse ?? key);
    if (action === "pay" && !held) {
      const invoice = await required(supplier).mintIdentifier();
      const sent = await required(supplier).startNegotiation({
        peer: { actor: p.identity.actor, party: p.identity.party },
        operation: { id: service, version: "0.1" },
        models: [],
        discover: false,
        configuration: CONFIG_ED25519,
        terms: {
          service: "Test service",
          compensation: { amount: String(amount), currency: "GBP", payee: "urn:payee" },
          invoice,
          purpose,
          validFrom: now().toISOString(),
          validUntil: "2027-01-01T00:00:00.000Z",
        },
      });
      expect(sent.outbound, JSON.stringify(sent)).toHaveLength(1);
      const accepted = await runtime.receive(required(sent.outbound[0]).wire);
      expect(accepted).toMatchObject({ disposition: "accepted" });
      expect(accepted.outbound[0]?.message.kind).toBe("accept");
      const confirmed = await required(supplier).receive(required(accepted.outbound[0]).wire);
      await runtime.receive(required(confirmed.outbound[0]).wire);
      held = { digest: required(runtime.agreements().at(-1)).termsDigest, invoice };
      agreements.set(key, held);
    }
    return runtime.runTask({
      taskId: `urn:task:${key}`,
      kind: "payment",
      plan: {
        adapter: "urn:adapter:bank",
        key: `urn:effect:${key}`,
        activityType: "urn:activity:payment",
        intent: {
          action,
          operation: op,
          target: op,
          recipient: "urn:bank",
          purpose,
          conversation: task,
          parameters:
            action === "pay"
              ? {
                  payee: "urn:payee",
                  account: "urn:account:payee",
                  amount,
                  currency: "GBP",
                  reference: required(held).invoice,
                  agreement: required(held).digest,
                  instalment: 1,
                  validUntil: "2026-12-31T09:00:00.000Z",
                }
              : {},
        },
        params:
          action === "pay"
            ? {
                payee: "urn:payee",
                account: "urn:account:payee",
                amount,
                currency: "GBP",
                reference: required(held).invoice,
                agreement: required(held).digest,
                instalment: 1,
                validUntil: "2026-12-31T09:00:00.000Z",
              }
            : {},
      },
    });
  };
  return {
    rt,
    make,
    store,
    replaceStore: (next: StateStore) => {
      store = next;
    },
    recorder,
    cast,
    pay,
    effects: () => effects,
    advance: (date: string) => {
      time = new Date(date);
    },
  };
}
it("persists monthly totals before release, refuses the fifth payment across restart, and starts a new calendar month", async () => {
  const f = await fixture();
  for (let i = 0; i < 4; i++) await f.pay(f.rt, String(i));
  expect(f.effects()).toBe(4);
  f.rt.close();
  const rt = await f.make();
  const fifth = await f.pay(rt, "fifth");
  expect(fifth.pendingApproval).toBeDefined();
  expect(f.effects()).toBe(4);
  expect(
    f.recorder.events().some((e) => e.outcome === "ask-principal" && e.reason === "limit-exceeded"),
  ).toBe(true);
  f.advance("2026-12-01T09:00:00.000Z");
  await f.pay(rt, "december");
  expect(f.effects()).toBe(5);
});
it("over-limit payment stops when the mandate gives the principal no discretion", async () => {
  const f = await fixture("pay", false);
  await f.pay(f.rt, "too-much", 501);
  expect(f.effects()).toBe(0);
  expect(f.recorder.events().at(-1)).toMatchObject({ outcome: "stop", reason: "limit-exceeded" });
});
it("a person-decision profile defeats an autonomous mandate and resumes only the exact signed approval", async () => {
  const f = await fixture("use", true, {
    personDecisions: [{ action: "use", decider: "principal" }],
  });
  const held = await f.pay(f.rt, "judgement");
  expect(held.pendingApproval).toBeDefined();
  expect(f.effects()).toBe(0);
  const pending = f.rt.pendingApprovals()[0];
  if (!pending) throw new Error("pending");
  expect(f.recorder.events().find((e) => e.kind === "ask-principal")?.chat?.text).toContain(
    pending.actionDigest,
  );
  const foreign = await f.cast.approval("payer", "wrong-digest", pending.conversation);
  expect((await f.rt.submitApproval(foreign)).outbound).toEqual([]);
  expect(f.effects()).toBe(0);
  await f.rt.submitApproval(
    await f.cast.approval("payer", pending.actionDigest, pending.conversation),
  );
  expect(f.effects()).toBe(1);
});

it("loads the spend reservations from an atomic file snapshot after closing the process's writer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-payment-"));
  try {
    const f = await fixture();
    f.rt.close();
    const file = join(directory, "state.json");
    let store = new FileStateStore(file);
    store.save(f.store.load());
    f.replaceStore(store);
    let rt = await f.make();
    for (let i = 0; i < 4; i++) await f.pay(rt, `file-${i}`);
    rt.close();
    store = new FileStateStore(file);
    f.replaceStore(store);
    rt = await f.make();
    await f.pay(rt, "file-fifth");
    expect(f.effects()).toBe(4);
    expect(Object.values(store.load().paymentTotals)).toEqual([200000]);
    rt.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("approving an over-limit payment releases it once and cannot approve a second effect with the same digest", async () => {
  const f = await fixture();
  const held = await f.pay(f.rt, "exception", 600);
  expect(held.pendingApproval).toBeDefined();
  const pending = f.rt.pendingApprovals()[0];
  if (!pending) throw new Error("pending");
  const jws = await f.cast.approval(
    "payer",
    pending.actionDigest,
    pending.conversation,
    "approve",
    "Approve this exact payment.",
    f.rt.paymentApprovalBinding(pending.actionDigest),
  );
  await f.rt.submitApproval(jws);
  expect(f.effects()).toBe(1);
  await f.pay(f.rt, "second-exception", 600, "exception");
  expect(f.effects()).toBe(1);
  expect((await f.rt.submitApproval(jws)).disposition).toBe("rejected");
});

it("payment approval must explicitly bind both the terms and the exact order", async () => {
  const f = await fixture();
  await f.pay(f.rt, "bound-approval", 600);
  const pending = required(f.rt.pendingApprovals()[0]);
  const binding = required(f.rt.paymentApprovalBinding(pending.actionDigest));
  for (const payment of [
    undefined,
    { ...binding, termsDigest: "other" },
    { ...binding, orderDigest: "other" },
  ]) {
    const signed = await f.cast.approval(
      "payer",
      pending.actionDigest,
      pending.conversation,
      "approve",
      "Approve these exact terms.",
      payment,
    );
    expect((await f.rt.submitApproval(signed)).reason).toBe("approval-denied");
    expect(f.effects()).toBe(0);
  }
  await f.rt.submitApproval(
    await f.cast.approval(
      "payer",
      pending.actionDigest,
      pending.conversation,
      "approve",
      "Approve this payment.",
      binding,
    ),
  );
  expect(f.effects()).toBe(1);
});
it("payment once keys survive restart and cannot be bypassed by a new effect key", async () => {
  const f = await fixture();
  await f.pay(f.rt, "once");
  f.rt.close();
  const rt = await f.make();
  await f.pay(rt, "again", 500, "once");
  expect(f.effects()).toBe(1);
  expect(f.recorder.events().findLast((e) => e.check === "P7")).toMatchObject({
    verdict: "fail",
    reason: "replay-conflict",
  });
});
it("a signed principal denial is recorded as a P6 refusal and never executes", async () => {
  const f = await fixture();
  await f.pay(f.rt, "decline", 600);
  const pending = required(f.rt.pendingApprovals()[0]);
  await f.rt.submitApproval(
    await f.cast.approval(
      "payer",
      pending.actionDigest,
      pending.conversation,
      "deny",
      "No, do not pay.",
      f.rt.paymentApprovalBinding(pending.actionDigest),
    ),
  );
  expect(f.effects()).toBe(0);
  expect(f.recorder.events().findLast((e) => e.check === "P6")).toMatchObject({
    verdict: "fail",
    reason: "approval-denied",
  });
});
