// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { GateMemory, type ItemTerms } from "../src/gates/common.js";
import { OutboundGate } from "../src/gates/outbound.js";
import { acceptsOfferedTerms, evaluateItemTerms } from "../src/gates/quality.js";
import { BASELINE } from "../src/suites/baseline.js";

const at = "2026-11-13T09:00:00.000Z";
const need = {
  agent: "urn:test:agent",
  action: "use" as const,
  target: "urn:test:item",
  purpose: "urn:test:discount",
  at,
};
const base = (): ItemTerms => ({
  policy: { id: "urn:test:terms", permissions: [{ type: "permission", action: "use" }] },
});
it("never turns unknown permissions, prohibitions, constraints or duties into permission, including inherited policies", () => {
  for (const action of ["training", "profile-person", "resell-insights"]) {
    for (const kind of ["permissions", "prohibitions", "obligations"] as const) {
      const terms = base();
      const unknown = {
        type:
          kind === "permissions"
            ? "permission"
            : kind === "prohibitions"
              ? "prohibition"
              : "obligation",
        action,
        target: "urn:test:unrelated-target",
      };
      const policy = { ...terms.policy, [kind]: [...(terms.policy[kind] ?? []), unknown] };
      expect(evaluateItemTerms({ policy } as ItemTerms, need), `${kind}/${action}`).toMatchObject({
        verdict: "indeterminate",
        reason: "unsupported-term",
      });
      expect(
        evaluateItemTerms(
          {
            policy: { id: "urn:test:derived" },
            inherited: [{ target: need.target, terms: { policy } as ItemTerms }],
          },
          need,
        ),
      ).toMatchObject({ verdict: "indeterminate", reason: "unsupported-term" });
    }
  }
  for (const constraint of [
    { leftOperand: "unknown-purpose", operator: "eq", rightOperand: "x" },
    { leftOperand: "purpose", operator: "approximately", rightOperand: need.purpose },
  ]) {
    const terms = base();
    expect(
      evaluateItemTerms(
        {
          policy: {
            ...terms.policy,
            prohibitions: [{ type: "prohibition", action: "read", constraints: [constraint] }],
          },
        } as unknown as ItemTerms,
        need,
      ),
    ).toMatchObject({ verdict: "indeterminate", reason: "unsupported-term" });
  }
  expect(
    evaluateItemTerms(
      {
        policy: {
          ...base().policy,
          permissions: [
            { type: "permission", action: "use", duties: [{ action: "notify-everyone" }] },
          ],
        },
      } as unknown as ItemTerms,
      need,
    ),
  ).toMatchObject({ verdict: "indeterminate", reason: "unsupported-term" });
  expect(evaluateItemTerms(base(), need).verdict).toBe("pass");
  expect(
    evaluateItemTerms(
      { policy: { ...base().policy, prohibitions: [{ type: "prohibition", action: "use" }] } },
      need,
    ),
  ).toMatchObject({ verdict: "fail", reason: "prohibited" });
});
it("accepts only uses within the principal's policy, rejecting broad and underwriting permissions", () => {
  const offered = (purposes: string[]): ItemTerms => ({
    policy: {
      id: "urn:test:offered",
      permissions: [
        {
          type: "permission",
          action: "use",
          constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: purposes }],
        },
      ],
    },
  });
  expect(acceptsOfferedTerms(offered([need.purpose]), [need.purpose])).toBe(true);
  expect(
    acceptsOfferedTerms(offered([need.purpose, "urn:test:underwriting"]), [need.purpose]),
  ).toBe(false);
  expect(acceptsOfferedTerms(base(), [need.purpose])).toBe(false);
});
it("refuses insurer underwriting terms inbound and keeps the request outside core context", async () => {
  const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "wearable-data");
  const paths = await runScenario(profile, scenario);
  expect(paths[1]?.actual).toMatchObject({
    outcome: "refuse",
    reason: "terms-not-acceptable",
    check: "terms",
  });
  expect(paths[1]?.disagrees).toBe(false);
  const events = paths[1]?.trace?.events ?? [];
  expect(
    events.some(
      (e) =>
        e.agent === "owner-agent" &&
        e.check === "terms" &&
        e.verdict === "fail" &&
        e.reason === "terms-not-acceptable",
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.agent === "owner-agent" && e.kind === "message-out" && e.packet?.kind === "invoke",
    ),
  ).toBe(false);
});

it("does not let issuer-authored terms text hide an unknown prohibition on a released item", async () => {
  const memory = new GateMemory();
  const terms = {
    policy: { ...base().policy, prohibitions: [{ type: "prohibition", action: "training" }] },
  } as unknown as ItemTerms;
  const fact = {
    id: need.target,
    label: "article",
    claimType: "article",
    source: "urn:test:publisher",
    terms,
  };
  memory.facts.set(fact.id, fact);
  const gate = new OutboundGate({
    identity: { actor: need.agent, party: "urn:test:publisher" },
    now: () => at,
    mandate: () => undefined,
    gate: { configuration: BASELINE, purposes: { [need.purpose]: ["article"] } },
    memory,
    isReplyTo: () => true,
    offerTerms: () => ({ evidenceRequest: [{ claimType: "article" }] }),
  });
  const intent = {
    action: "distribute",
    operation: "urn:test:share",
    target: "urn:test:share",
    conversation: "urn:test:conversation",
    purpose: need.purpose,
    parameters: {
      evidence: [fact.id],
      attachedTerms: "Reading permitted; do not train.",
      termsDigest: "digest",
    },
  };
  const result = gate.release(intent, {
    type: "authorisation-decision",
    decider: need.agent,
    action: intent,
    actionDigest: digestOf(intent),
    at,
    outcome: "permit",
    reason: "within-mandate",
    policy: { id: "urn:test:mandate", digest: "digest", evaluator: "test" },
  });
  expect(result).toMatchObject({ outcome: "stop", decision: { reason: "unsupported-term" } });
});
