// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import type { JsonObject } from "../src/core/types.js";
import { ruleSchema } from "../src/derive/rules.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { testKey } from "../src/reference/keys.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";

const op = { id: "urn:op:assessment", version: "0.1" },
  purpose = "urn:purpose:assessment",
  task = "urn:task:assessment",
  subject = "urn:fictional:client",
  at = "2026-11-13T09:00:00.000Z";
it("assesses only under agreed purpose, retains only output, evidences discard and cannot reuse erased inputs", async () => {
  const cast = new Cast(() => new Date(at));
  for (const name of ["client", "lender"])
    await cast.add(
      { name, actor: `urn:fictional:${name}:agent`, party: `urn:fictional:${name}` },
      mandateOf("assess", [
        { id: `urn:rule:${name}`, type: "permission", action: "use", target: op.id },
      ]),
      [op.id],
    );
  cast.introduce("client", "lender");
  const source = await testKey("assessment/payroll");
  cast.pinIssuer("lender", "urn:fictional:payroll", source);
  cast.rule("lender", {
    id: "urn:rule:payroll",
    version: "1",
    source: "urn:fictional:payroll",
    claimTypes: ["monthly-pay"],
    subjects: [subject],
  });
  const rules = [
    ruleSchema.parse({
      id: "urn:rule:annualise",
      template: "annualise-consecutive-months",
      params: { input: "monthly-pay", months: 2 },
      output: "annual-pay",
      inputsFrom: ["urn:fictional:payroll"],
    }),
  ];
  const handler: OperationHandler = {
    description: {
      ...op,
      label: "Assessment",
      pattern: "negotiate",
      access: "represented",
      models: [],
      roles: ["initiator", "responder"],
      effects: [],
      outcomes: [],
    },
    requiresRepresentation: true,
    intentForProposal: (ctx) => ({
      action: "use",
      operation: op.id,
      target: op.id,
      conversation: ctx.conversation.id,
      purpose,
      recipient: ctx.peer.party,
      parameters: {},
    }),
    onProposal: (ctx) => ({
      type: "accept",
      intent: {
        action: "use",
        operation: op.id,
        target: op.id,
        conversation: ctx.conversation.id,
        purpose,
        recipient: ctx.peer.party,
        parameters: {},
      },
    }),
  };
  const store = new MemoryStateStore(),
    ledger = new MemoryLedger();
  const p = cast.get("lender");
  const lender = await AgentRuntime.create({
    identity: { actor: p.identity.actor, party: p.identity.party },
    actorKeys: [p.actorKey],
    trust: await TrustStore.load(cast.trust.get("lender")),
    mandateJws: p.mandateJws,
    representationJws: p.representationJws,
    accepted: [CONFIG_ED25519],
    handlers: [handler],
    store,
    ledger,
    now: () => new Date(at),
    gates: {
      taskId: task,
      rules,
      assessments: [
        {
          id: "urn:assessment:annual",
          rule: "urn:rule:annualise",
          purpose,
          keep: ["output"],
          discardInputsAfter: "evaluation",
        },
        {
          id: "urn:assessment:wrong-purpose",
          rule: "urn:rule:annualise",
          purpose: "urn:purpose:marketing",
          keep: ["output"],
          discardInputsAfter: "evaluation",
        },
      ],
      vocabulary: { "terms.purpose": { type: "identifier" } },
      purposes: { [purpose]: ["monthly-pay"] },
      reliance: {
        id: "urn:reliance",
        rules: [
          {
            id: "urn:rule:quality",
            claimType: "monthly-pay",
            methods: ["recorded-by-authority"],
            maxAgeDays: 30,
            text: "fictional payroll",
          },
        ],
      },
    },
  });
  const { runtime: client } = await cast.runtime("client", [handler], [], [CONFIG_ED25519], {
    gates: {
      vocabulary: { "terms.purpose": { type: "identifier" } },
      purposes: { [purpose]: ["monthly-pay"] },
    },
  });
  const claim: JsonObject = {
    id: "urn:pay:input",
    issuer: "urn:fictional:payroll",
    subject,
    claimType: "monthly-pay",
    method: "recorded-by-authority",
    asOf: at,
    monthly: [
      { month: "2026-10", value: 4000 },
      { month: "2026-11", value: 4000 },
    ],
  };
  await lender.admitStatements([{ jws: await signClaim(source, claim) }], {
    subject,
    task,
    taskId: task,
    purpose,
  });
  expect(
    await lender.assess({ assessment: "urn:assessment:annual", agreement: "urn:missing", subject }),
  ).toMatchObject({ ok: false, reason: "no-agreement" });
  const sent = await client.startNegotiation({
    peer: { actor: p.identity.actor, party: p.identity.party },
    operation: op,
    terms: { purpose },
    models: [],
    discover: false,
    configuration: CONFIG_ED25519,
  });
  const accepted = await lender.receive(sent.outbound[0]?.wire);
  expect(accepted.outbound).toHaveLength(1);
  const acceptance = accepted.outbound[0];
  if (!acceptance) throw new Error("missing acceptance");
  const agreement = (acceptance.message.body as { agreement: string }).agreement;
  expect(
    await lender.assess({ assessment: "urn:assessment:wrong-purpose", agreement, subject }),
  ).toMatchObject({ ok: false, reason: "purpose-not-permitted" });
  const result = await lender.assess({ assessment: "urn:assessment:annual", agreement, subject });
  expect(result).toMatchObject({
    ok: true,
    statement: { value: 48000 },
    receipt: { kept: ["output"], discarded: [claim.id], duty: "discharged" },
  });
  expect(JSON.stringify(store.load())).not.toContain('"monthly":');
  expect(store.load().contextItems[task]?.find((item) => item.id === claim.id)).toMatchObject({
    accepted: false,
    kind: "memory",
  });
  expect(
    store.load().contextItems[task]?.find((item) => item.id === claim.id)?.statement,
  ).toBeUndefined();
  expect(ledger.entries().some((entry) => entry.record.type === "duty-discharged")).toBe(true);
  expect(await lender.derive({ rule: rules[0]?.id as string, subject, purpose })).toMatchObject({
    ok: false,
    reason: "completeness-not-established",
  });
});
