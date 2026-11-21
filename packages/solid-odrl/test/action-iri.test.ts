// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import {
  OdrlSerializationError,
  parsePolicy,
  policyFromRdf,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
} from "../src/policy.js";
import type { OdrlPolicy } from "../src/types.js";
import { ACTION_IRI, ODRL_ACTION, ODRL_ACTIONS } from "../src/vocab.js";

function policy(action: string, dutyAction = action): OdrlPolicy {
  return {
    id: "urn:test:policy",
    type: "Set",
    permissions: [{ type: "permission", action, duties: [{ action: dutyAction }] }],
    prohibitions: [{ type: "prohibition", action }],
    obligations: [{ action: dutyAction }],
  } as OdrlPolicy;
}

it.each([
  ...ODRL_ACTIONS.map((name) => [name, ACTION_IRI[name]] as const),
  ["urn:test:Pay", "urn:test:Pay"],
  ["https://EXAMPLE.org:443/é#pay", "https://EXAMPLE.org:443/é#pay"],
])("preserves action %s in rules and duties", async (action, iri) => {
  const input = policy(action);
  const actions = policyToRdf(input).filter((quad) => quad.predicate.value === ODRL_ACTION);
  expect(actions).toHaveLength(4);
  for (const quad of actions)
    expect(quad.object).toMatchObject({ termType: "NamedNode", value: iri });
  expect(JSON.stringify(policyToJsonLd(input)).split(iri).length - 1).toBe(4);
  const options = action === iri ? { allowedActionIris: [iri] } : undefined;
  expect(await parsePolicy(await policyToTurtle(input), undefined, undefined, options)).toEqual(
    input,
  );
});

it("reads only the listed extension action IRIs in rules and duties", async () => {
  const allowed = "urn:test:Pay";
  const unlisted = "urn:test:pay";
  const standardRule = { type: "permission", action: "read" } as const;
  const input: OdrlPolicy = {
    id: "urn:test:policy",
    type: "Set",
    permissions: [
      { ...standardRule, duties: [{ action: allowed }, { action: unlisted }] },
      { type: "permission", action: allowed },
      { type: "permission", action: unlisted },
    ],
    prohibitions: [
      { type: "prohibition", action: allowed },
      { type: "prohibition", action: unlisted },
    ],
    obligations: [{ action: allowed }, { action: unlisted }],
  };
  const turtle = await policyToTurtle(input);
  const dataset = await parseRdf(turtle, "text/turtle");
  const defaults = { id: input.id, type: input.type, permissions: [standardRule] };
  expect(await parsePolicy(turtle)).toEqual(defaults);
  expect(policyFromRdf(dataset)).toEqual(defaults);

  const options = { allowedActionIris: [allowed] };
  const optedIn = {
    ...defaults,
    permissions: [
      { ...standardRule, duties: [{ action: allowed }] },
      { type: "permission", action: allowed },
    ],
    prohibitions: [{ type: "prohibition", action: allowed }],
    obligations: [{ action: allowed }],
  };
  expect(await parsePolicy(turtle, "text/turtle", undefined, options)).toEqual(optedIn);
  expect(policyFromRdf(dataset, options)).toEqual(optedIn);
});

it.each([
  "pay",
  "constructor",
  "/action",
  "urn:test:bad action",
  "urn:test:>",
])("rejects invalid action %s in every writer", (action) => {
  for (const write of [policyToRdf, policyToJsonLd, policyToTurtle]) {
    for (const input of [policy(action, "read"), policy("read", action)]) {
      expect(() => write(input)).toThrow(OdrlSerializationError);
      expect(() => write(input)).toThrow(/action.*absolute IRI/i);
    }
  }
});

it("keeps profile rules outside the standard evaluator's action hierarchy", () => {
  const extension = "urn:test:Pay";
  const input = policy(extension, "read");
  const request = { target: "urn:test:asset", assignee: "urn:test:party" };
  expect(evaluate(input, { ...request, action: extension })).toMatchObject({
    decision: "notApplicable",
    matchedPermissions: [],
    matchedProhibitions: [],
  });
  expect(evaluate(input, { ...request, action: "read" })).toMatchObject({
    decision: "notApplicable",
    matchedPermissions: [],
    matchedProhibitions: [],
  });
});
