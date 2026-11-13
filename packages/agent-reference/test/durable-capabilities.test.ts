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
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";

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
      [r],
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
    [op],
  );
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
      handlers: [],
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
  const pay = (runtime: AgentRuntime, key: string, amount = 500) =>
    runtime.runTask({
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
                  reference: "urn:invoice",
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
                reference: "urn:invoice",
              }
            : {},
      },
    });
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
  const jws = await f.cast.approval("payer", pending.actionDigest, pending.conversation);
  await f.rt.submitApproval(jws);
  expect(f.effects()).toBe(1);
  await f.pay(f.rt, "second-exception", 600);
  expect(f.effects()).toBe(1);
  expect((await f.rt.submitApproval(jws)).disposition).toBe("rejected");
});
