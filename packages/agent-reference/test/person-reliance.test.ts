// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { ActionIntent, EvidenceItem, JsonObject } from "../src/core/types.js";
import { loadCase, validateReferences } from "../src/engine/load.js";
import { domainProfileSchema } from "../src/engine/schema.js";
import { signCompact } from "../src/mechanisms/jws.js";
import { TYP } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { CONFIG_ED25519 } from "../src/profile/configurations.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import type { HandlerContext, OperationHandler } from "../src/runtime/operations.js";
import { Cast, mandateOf, signClaim } from "../src/scenarios/common.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";
import { BASELINE } from "../src/suites/baseline.js";
import { TraceRecorder } from "../src/trace/recorder.js";

const AT = "2026-11-13T09:00:00.000Z";
const OP = { id: "urn:test:introduction", version: "0.1" };
const TASK = "urn:test:reliance-task";
const PURPOSE = "urn:test:introduction-purpose";
async function fixture(enabled = true, requiredAtIntake = false, unsafeAction?: string) {
  const cast = new Cast(() => new Date(AT));
  await cast.add(
    { name: "author", party: "urn:test:author", actor: "urn:test:author-agent" },
    mandateOf("author", []),
    [OP.id],
  );
  await cast.add(
    { name: "receiver", party: "urn:test:receiver", actor: "urn:test:receiver-agent" },
    mandateOf("receiver", [], [{ type: "permission", action: "read", target: OP.id }]),
    [OP.id],
  );
  cast.introduce("author", "receiver");
  if (requiredAtIntake)
    cast.rule("receiver", {
      id: "urn:test:accepted-author",
      version: "1",
      source: "urn:test:author",
      claimTypes: ["identity.verified"],
      subjects: "any",
    });
  const store = new MemoryStateStore();
  const recorder = new TraceRecorder();
  const core: { context: HandlerContext; evidence: readonly EvidenceItem[] }[] = [];
  let executions = 0;
  const handler: OperationHandler = {
    requiresRepresentation: false,
    description: {
      ...OP,
      label: "Consider a personal introduction",
      pattern: "invoke",
      roles: ["initiator", "responder"],
      access: "represented",
      models: [],
      effects: [],
      outcomes: [],
    },
    onInvoke: (context, _body, evidence) => {
      core.push({ context, evidence });
      return { type: "none" };
    },
  };
  const trust = await TrustStore.load(cast.trust.get("receiver"));
  const provisioned = cast.get("receiver");
  const runtime = await AgentRuntime.create({
    identity: { actor: "urn:test:receiver-agent", party: "urn:test:receiver" },
    actorKeys: [provisioned.actorKey],
    trust,
    mandateJws: provisioned.mandateJws,
    representationJws: provisioned.representationJws,
    accepted: [CONFIG_ED25519],
    handlers: [handler],
    store,
    ledger: new MemoryLedger(),
    now: () => new Date(AT),
    gates: {
      configuration: BASELINE,
      taskId: TASK,
      sink: recorder.sink("receiver"),
      personMayRelyOn: enabled ? ["identity.verified"] : [],
      actionClaims: [
        ...(unsafeAction ? [{ action: unsafeAction, claims: ["identity.verified"] }] : []),
        { action: "read", claims: ["identity.verified"] },
        ...(requiredAtIntake ? [{ action: OP.id, claims: ["identity.verified"] }] : []),
      ],
      claimSources: {
        "identity.verified": [requiredAtIntake ? "urn:test:author" : "urn:test:identity-provider"],
      },
      reliance: {
        id: "urn:test:reliance",
        rules: [
          {
            id: "urn:test:rule",
            claimType: "identity.verified",
            methods: ["recorded-by-authority"],
            maxAgeDays: 30,
            text: "Require an identity provider",
          },
        ],
      },
    },
    effects: [
      {
        id: "urn:test:consider",
        execute: async () => {
          executions++;
          return { conclusion: "completed", observed: {} };
        },
        reconcile: async () => ({ conclusion: "not-executed", reason: "no prior effect" }),
      },
    ],
  });
  const statement: JsonObject = {
    id: "urn:test:self-profile",
    issuer: "urn:test:author",
    subject: "urn:test:author",
    claimType: "identity.verified",
    method: "self-reported",
    asOf: AT,
    value: true,
  };
  const jws = await signClaim(cast.get("author").ownerKey, statement);
  const message = {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: "urn:test:profile-message",
    conversation: "urn:test:profile-conversation",
    kind: "invoke",
    from: { actor: "urn:test:author-agent", onBehalfOf: "urn:test:author" },
    to: { actor: "urn:test:receiver-agent", party: "urn:test:receiver" },
    createdAt: AT,
    expiresAt: "2026-11-13T09:10:00.000Z",
    body: { operation: OP, input: {}, basis: { kind: "represented" }, purpose: PURPOSE },
    evidence: [{ role: "credential", format: "jws-compact", value: jws }],
  };
  const received = await runtime.receive({
    format: "awp-jws-compact/0.1",
    jws: await signCompact(cast.get("author").actorKey, TYP.message, message),
  });
  const act = (suffix: string, parameters: JsonObject = {}) => {
    const intent: ActionIntent = {
      action: "read",
      operation: OP.id,
      target: OP.id,
      conversation: `${TASK}:${suffix}`,
      purpose: PURPOSE,
      parameters: { support: [String(statement.id)], ...parameters },
    };
    return runtime.runTask({
      taskId: intent.conversation,
      kind: "consider-introduction",
      plan: {
        key: `urn:test:effect:${suffix}`,
        adapter: "urn:test:consider",
        intent,
        params: {},
        activityType: "urn:test:consider",
      },
    });
  };
  return {
    runtime,
    cast,
    store,
    recorder,
    core,
    statement,
    act,
    message,
    received,
    executions: () => executions,
  };
}

it("never exposes a self-made statement to the core and builds the RL-8 question from the held statement", async () => {
  const f = await fixture();
  expect(f.core).toHaveLength(1);
  expect(f.core[0]?.evidence).toEqual([]);
  expect(f.core[0]?.context.message?.evidence).toEqual([]);
  expect(
    Object.values(f.store.load().contextItems)
      .flat()
      .some((i) => i.id === f.statement.id),
  ).toBe(false);
  expect(Object.values(f.store.load().relianceHolds)).toHaveLength(1);
  const result = await f.act("first");
  expect(result.decisions.at(-1)).toMatchObject({
    outcome: "approval-required",
    reason: "method-not-accepted",
  });
  const request = f.recorder.events().find((e) => e.kind === "ask-principal");
  for (const [key, value] of Object.entries(f.statement))
    expect(request?.chat?.text).toContain(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  expect(request?.chat?.text).toContain("Made by: urn:test:author");
  expect(request?.chat?.text).toContain("Nobody vouches for this statement");
  expect(
    f.recorder
      .events()
      .some((e) => e.check === "limits-approval" && e.reason === "method-not-accepted"),
  ).toBe(true);
  expect(f.executions()).toBe(0);
});

it("stops on no; a yes covers one exact action and cannot be replayed or reused for another action", async () => {
  for (const choice of ["approve", "deny"] as const) {
    const f = await fixture();
    const asked = await f.act("first");
    if (!asked.pendingApproval) throw new Error("missing reliance approval");
    const answer = await f.cast.approval(
      "receiver",
      asked.pendingApproval,
      `${TASK}:first`,
      choice,
    );
    await f.runtime.submitApproval(answer);
    expect(f.executions()).toBe(choice === "approve" ? 1 : 0);
    if (choice === "deny")
      expect(
        f.recorder.events().some((e) => e.outcome === "stop" && e.reason === "approval-denied"),
      ).toBe(true);
    if (choice === "approve") {
      expect(await f.runtime.submitApproval(answer)).toMatchObject({
        disposition: "rejected",
        reason: "approval-denied",
      });
      const another = await f.act("another", { changed: true });
      expect(another.decisions.at(-1)).toMatchObject({
        outcome: "approval-required",
        reason: "method-not-accepted",
      });
      expect(f.executions()).toBe(1);
      expect(
        f.core[0]?.context.admittedStatement(String(f.statement.id), digestOf(f.statement)),
      ).toBe(false);
      expect(
        Object.values(f.store.load().contextItems)
          .flat()
          .some((i) => i.id === f.statement.id),
      ).toBe(false);
    }
  }
});

it("keeps unlisted claims on the ordinary failure path and invalidates approval if the held statement changes", async () => {
  const unlisted = await fixture(false);
  expect((await unlisted.act("unlisted")).decisions.at(-1)?.outcome).toBe("deny");
  expect(unlisted.executions()).toBe(0);
  const f = await fixture();
  const asked = await f.act("first");
  if (!asked.pendingApproval) throw new Error("missing approval");
  // A distinct authenticated replacement under the same identifier must not reuse an old yes.
  const replacement = { ...f.statement, value: false };
  await f.runtime.admitStatements(
    [{ jws: await signClaim(f.cast.get("author").ownerKey, replacement) }],
    { task: TASK, purpose: PURPOSE },
  );
  await f.runtime.submitApproval(
    await f.cast.approval("receiver", asked.pendingApproval, `${TASK}:first`),
  );
  expect(f.executions()).toBe(0);
  expect(
    f.recorder.events().some((e) => e.outcome === "stop" && e.reason === "approval-denied"),
  ).toBe(true);
});

it("rejects personMayRelyOn at profile load for payment or unrestricted disclosure dependencies", () => {
  const { profile } = loadCase(join(import.meta.dirname, ".."), "introduction");
  for (const action of ["pay", "distribute"])
    expect(() =>
      domainProfileSchema.parse({
        ...profile,
        actionClaims: [{ action, claims: ["identity.verified"] }],
      }),
    ).toThrow("personMayRelyOn");
});

it("sends a gate-built replacement-evidence challenge and admits a cured retry only", async () => {
  const f = await fixture(false, true);
  expect(f.core).toHaveLength(0);
  let challenge = f.received.outbound[0]?.message;
  expect(challenge?.kind).toBe("challenge");
  expect(challenge?.body).toMatchObject({ reason: "method-not-accepted" });
  for (const text of ["identity.verified", "urn:test:author", "recorded-by-authority"])
    expect(JSON.stringify(challenge?.body)).toContain(text);
  expect(Object.values(f.store.load().contextItems).flat()).toEqual([]);
  for (const [index, method] of ["self-reported", "recorded-by-authority"].entries()) {
    if (challenge?.kind !== "challenge") throw new Error("missing evidence challenge");
    const replacement = { ...f.statement, method };
    const result = await f.runtime.receive({
      format: "awp-jws-compact/0.1",
      jws: await signCompact(f.cast.get("author").actorKey, TYP.message, {
        ...f.message,
        id: `urn:test:retry:${index}`,
        body: {
          ...f.message.body,
          challenge: { id: challenge.body.needs.id, nonce: challenge.body.needs.nonce },
        },
        evidence: [
          {
            role: "credential",
            format: "jws-compact",
            value: await signClaim(f.cast.get("author").ownerKey, replacement),
          },
        ],
      }),
    });
    expect(f.core).toHaveLength(index);
    if (index === 0) challenge = result.outbound[0]?.message;
    else
      expect(
        f.core[0]?.context.admittedStatement(String(f.statement.id), digestOf(replacement)),
      ).toBe(true);
  }
});

it("rejects a payment or third-party disclosure hidden in a scenario at load", () => {
  for (const action of ["pay", "distribute"]) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "introduction");
    const branch = scenario.branches[0];
    if (!branch) throw new Error("missing branch");
    const change = branch.change as { script: { intent?: JsonObject }[] };
    const step = change.script.at(-1);
    if (!step?.intent) throw new Error("missing action");
    step.intent.action = action;
    step.intent.recipient = "urn:test:third-person";
    expect(() => validateReferences(profile, scenario)).toThrow("personMayRelyOn");
  }
});

it("refuses an unknown offered term even when no optional acceptance policy is installed", async () => {
  const f = await fixture();
  const result = await f.runtime.receive({
    format: "awp-jws-compact/0.1",
    jws: await signCompact(f.cast.get("author").actorKey, TYP.message, {
      ...f.message,
      id: "urn:test:unknown-terms-message",
      conversation: "urn:test:unknown-terms-conversation",
      body: {
        ...f.message.body,
        input: {
          terms: {
            policy: {
              id: "urn:test:unknown-terms",
              permissions: [{ type: "permission", action: "use" }],
              prohibitions: [{ type: "prohibition", action: "training" }],
            },
          },
        },
      },
      evidence: [],
    }),
  });
  expect(result.outbound[0]?.message.body).toMatchObject({ reason: "unsupported-term" });
  expect(f.core).toHaveLength(1);
  expect(
    f.recorder.events().some((e) => e.outcome === "refuse" && e.reason === "unsupported-term"),
  ).toBe(true);
});

it("rejects unsafe reliance dependencies when a runtime loads gate settings directly", async () => {
  for (const action of ["pay", "distribute"])
    await expect(fixture(true, false, action)).rejects.toThrow("personMayRelyOn");
});
