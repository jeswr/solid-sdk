// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { ACTION_IRI, evaluate, ODRL, policyFromRdf } from "@jeswr/solid-odrl";
import { describe, expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { loadCase } from "../src/engine/load.js";
import { evaluateIntent, loadMandate, standingRuleSchema } from "../src/mechanisms/mandate.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { IndexedStore } from "../src/model/indexed-store.js";
import { readPolicy, writePolicy } from "../src/model/store/memory.js";
import {
  mandateDataset,
  mandateFromStore,
  type NativePolicy,
  policyDataset,
  policyFromStore,
} from "../src/model/store/policy.js";
import { AWP } from "../src/profile/vocabulary.js";
import { dutyRuleSchema } from "../src/runtime/duties.js";
import { Cast, mandateOf } from "../src/scenarios/common.js";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";

it("restores native policy order, inherited parties, explicit empties and exact payment extensions", () => {
  const input = {
    id: "urn:example:policy",
    assigner: "urn:example:owner",
    permissions: [
      {
        type: "permission",
        action: "pay",
        id: "urn:rule:z",
        constraints: [
          {
            leftOperand: "purpose",
            operator: "isAnyOf",
            rightOperand: ["urn:example:z", "urn:example:a", "urn:example:z"],
          },
        ],
        limit: { perAction: 3, perPeriod: 7, period: "calendar-month", currency: "GBP" },
      },
      { type: "permission", action: "use", id: "urn:rule:a", constraints: [] },
      { type: "permission", action: "read", duties: [{ action: "attribute" }] },
    ],
    prohibitions: [],
  } as const;
  const rdf = readNQuads(writeNQuads(policyDataset(input)));
  expect(rdf.getObjects(null, ODRL + "action", null).map((node) => node.value)).toEqual(
    expect.arrayContaining([AWP + "pay", ACTION_IRI.use, ACTION_IRI.read, ACTION_IRI.attribute]),
  );
  const standard = policyFromRdf(rdf);
  expect(standard?.permissions?.map((rule) => rule.action).sort()).toEqual(["read", "use"]);
  const decoded = policyFromStore(rdf, input.id);
  expect(decoded).toEqual(input);
  expect(digestOf(decoded)).toBe(digestOf(input));
});

it("retains the verified invoice mandate and its monthly payment authorization", async () => {
  const at = "2026-11-13T09:15:00.000Z";
  const scenarioId = "pay-an-invoice";
  const { profile, scenario } = loadCase(new URL("../", import.meta.url).pathname, scenarioId);
  const fixture = scenario.parties.find(({ id }) => id === "business-agent")!;
  const principal = scenario.parties.find(({ id }) => id === fixture.actsFor)!;
  const native = scenario.mandates.find(({ agent }) => agent === fixture.id)!;
  const cast = new Cast(() => new Date(at));
  const provisioned = await cast.add(
    { name: fixture.id, actor: fixture.actor!, party: principal.identity! },
    mandateOf(
      scenarioId,
      native.autonomous as unknown as Parameters<typeof mandateOf>[1],
      native.withApproval as unknown as Parameters<typeof mandateOf>[2],
      native.prohibitions as unknown as Parameters<typeof mandateOf>[3],
      native.standingRules.map((rule) => standingRuleSchema.parse(rule)),
      (native.duties ?? []).map((rule) => dutyRuleSchema.parse(rule)),
    ),
    fixture.representationOperations ?? profile.operations.map(({ id }) => id),
  );
  const verified = await loadMandate(provisioned.mandateJws, {
    trust: await TrustStore.load(provisioned.trust),
    actor: fixture.actor!,
    limits: DEFAULT_LIMITS,
    at,
  });
  if (!verified.ok) throw new Error(verified.reason);
  const { loaded } = verified;
  const graph = mandateDataset(loaded);
  expect(mandateDataset(loaded)).toBe(graph);
  const decoded = mandateFromStore(readNQuads(writeNQuads(graph)), loaded);
  expect(decoded).toEqual(loaded.mandate);
  expect(digestOf(decoded)).toBe(loaded.digest);
  const input: Parameters<typeof evaluateIntent>[0] = {
    loaded,
    at,
    decider: fixture.actor!,
    intent: {
      conversation: "urn:example:invoice",
      action: "pay",
      operation: "urn:op:payment",
      target: "urn:op:payment",
      recipient: "urn:fictional:bank",
      purpose: "urn:purpose:pay-an-invoice",
      parameters: {},
    },
  };
  const before = evaluateIntent(input);
  expect(before).toMatchObject({ outcome: "permit", matchedRule: "urn:rule:monthly-payments" });
  expect(evaluateIntent({ ...input, loaded: { ...loaded, mandate: decoded } })).toEqual(before);
});

it("preserves distinct ordered rules carrying the same native identifier", () => {
  const input = {
    id: "urn:example:policy",
    permissions: [
      { id: "urn:rule:shared", type: "permission", action: "read", target: "urn:example:z" },
      { id: "urn:rule:shared", type: "permission", action: "read", target: "urn:example:a" },
    ],
  } as const;
  expect(policyFromStore(readNQuads(writeNQuads(policyDataset(input))), input.id)).toEqual(input);
});

it("keeps memory grants with a shared native policy ID separate", () => {
  const input = ["urn:example:clinical", "urn:example:patient-note"].map(
    (target) =>
      ({
        id: "urn:example:shared-grant",
        permissions: [{ type: "permission", action: "use", target }],
      }) as const,
  );
  const dataset = new IndexedStore();
  const add = writePolicy(dataset);
  const ids = input.map(add);
  expect(new Set(ids).size).toBe(2);
  const read = readPolicy(readNQuads(writeNQuads(dataset)));
  expect(ids.map(read)).toEqual(input);
  expect(dataset.getObjects(null, ODRL + "uid", null).map((term) => term.value)).toEqual([
    input[0]!.id,
  ]);
});

it("projects exact DID parties and targets while restoring native inheritance", () => {
  const input = {
    id: "urn:example:did-policy",
    assigner: "did:web:harbour.identity.example",
    assignee: "https://example.test/user",
    profile: ["https://example.test/policy", "did:web:example.test:profile"],
    permissions: [
      {
        type: "permission",
        action: "read",
        assignee: "did:web:example.test:reader",
        target: "did:web:example.test:target",
        duties: [{ action: "delete", target: "did:web:example.test:target" }],
      },
      { type: "permission", action: "use" },
    ],
  } as const;
  const graph = readNQuads(writeNQuads(policyDataset(input)));
  const projected = policyFromRdf(graph);
  expect(projected?.permissions?.map(({ assigner }) => assigner)).toEqual([
    input.assigner,
    input.assigner,
  ]);
  expect(policyFromStore(graph, input.id)).toEqual(input);
});

describe.each(["memory", "mandate"] as const)("%s policy projection", (mode) => {
  function roundTrip(input: NativePolicy) {
    const dataset = new IndexedStore();
    if (mode === "memory") {
      const id = writePolicy(dataset)(input);
      return readPolicy(readNQuads(writeNQuads(dataset)))(id);
    }
    return policyFromStore(readNQuads(writeNQuads(policyDataset(input))), input.id);
  }

  it.each([
    "assigner",
    "profile",
  ] as const)("binds rules by IRI when a %s names a later rule", (field) => {
    const input: NativePolicy = {
      id: "urn:example:policy",
      [field]: "urn:rule:records:second",
      permissions: [
        {
          id: "urn:rule:records:first",
          type: "permission",
          action: "read",
          approvals: { count: 1, roles: ["owner"], distinctFromRequester: true },
        },
        {
          id: "urn:rule:records:second",
          type: "permission",
          action: "pay",
          limit: { perAction: 3, perPeriod: 7, period: "calendar-month", currency: "GBP" },
          constraints: [],
        },
        { type: "permission", action: "use" },
      ],
    };
    expect(roundTrip(input)).toEqual(input);
  });

  it("binds duties by IRI when a target names a later duty", () => {
    const input = {
      id: "urn:example:policy",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: "urn:duty:second",
          duties: [
            { action: "attribute", target: "urn:example:creator" },
            { action: "delete", id: "urn:duty:second", constraints: [] },
          ],
        },
      ],
    } as const;
    expect(roundTrip(input)).toEqual(input);
  });

  it("retains the native spelling and evaluation of a standard ACL action IRI", () => {
    const input = {
      id: "urn:example:policy",
      permissions: [{ type: "permission", action: "append" }],
      prohibitions: [{ type: "prohibition", action: ACTION_IRI.append as `${string}:${string}` }],
    } as const;
    const request = { action: "append" } as const;
    expect(evaluate(input, request).decision).toBe("permit");
    const decoded = roundTrip(input);
    expect(evaluate(decoded as Parameters<typeof evaluate>[0], request).decision).toBe("permit");
    expect(decoded).toEqual(input);
  });
});
