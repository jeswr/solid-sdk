// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Express + parse round-trip tests: build an ODRL policy, serialise to Turtle /
// JSON-LD, parse it back, and assert the policy fields survive. Also asserts the
// emitted graph uses the REAL ODRL vocabulary IRIs.

import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  parsePolicy,
  policyFromRdf,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
} from "../src/policy.js";
import type { OdrlPolicy } from "../src/types.js";
import { ACL, ODRL } from "../src/vocab.js";

const OWNER = "https://alice.example/profile/card#me";
const AGENT = "https://bob.example/profile/card#me";
const RESOURCE = "https://alice.example/notes/private.ttl";

const RICH_POLICY: OdrlPolicy = {
  id: "https://alice.example/policies/p1",
  type: "Offer",
  profile: "https://w3id.org/oac#",
  assigner: OWNER,
  conflict: "prohibit",
  permissions: [
    {
      type: "permission",
      action: "read",
      target: RESOURCE,
      assignee: AGENT,
      constraints: [
        {
          leftOperand: "purpose",
          operator: "eq",
          rightOperand: "https://w3id.org/dpv#ResearchAndDevelopment",
        },
        {
          leftOperand: "dateTime",
          operator: "lteq",
          rightOperand: "2027-01-01T00:00:00Z",
        },
      ],
      duties: [
        {
          action: "attribute",
          constraints: [{ leftOperand: "recipient", operator: "eq", rightOperand: OWNER }],
        },
      ],
    },
  ],
  prohibitions: [
    {
      type: "prohibition",
      action: "distribute",
      target: RESOURCE,
    },
  ],
  obligations: [{ action: "inform", target: OWNER }],
};

describe("policyToRdf / express", () => {
  it("emits the real ODRL namespace IRIs", () => {
    const quads = policyToRdf(RICH_POLICY);
    const predicates = new Set(quads.map((q) => q.predicate.value));
    expect(predicates.has(`${ODRL}permission`)).toBe(true);
    expect(predicates.has(`${ODRL}prohibition`)).toBe(true);
    expect(predicates.has(`${ODRL}obligation`)).toBe(true);
    expect(predicates.has(`${ODRL}action`)).toBe(true);
    expect(predicates.has(`${ODRL}constraint`)).toBe(true);
    expect(predicates.has(`${ODRL}leftOperand`)).toBe(true);
    // The action object IRI is the real odrl:read.
    const actionObjs = quads
      .filter((q) => q.predicate.value === `${ODRL}action`)
      .map((q) => q.object.value);
    expect(actionObjs).toContain(`${ODRL}read`);
    expect(actionObjs).toContain(`${ODRL}distribute`);
  });

  it("types the policy as an odrl:Offer and sets uid", () => {
    const quads = policyToRdf(RICH_POLICY);
    const typeQuad = quads.find(
      (q) => q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    );
    expect(typeQuad?.object.value).toBe(`${ODRL}Offer`);
    const uid = quads.find((q) => q.predicate.value === `${ODRL}uid`);
    expect(uid?.object.value).toBe(RICH_POLICY.id);
  });

  it("inherits the policy-level assigner onto rules that omit one", () => {
    const quads = policyToRdf(RICH_POLICY);
    const assigners = quads
      .filter((q) => q.predicate.value === `${ODRL}assigner`)
      .map((q) => q.object.value);
    // Owner appears as the policy assigner AND on the inherited rule assigners.
    expect(assigners.filter((a) => a === OWNER).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Turtle round-trip", () => {
  it("round-trips a rich policy losslessly on its fields", async () => {
    const ttl = await policyToTurtle(RICH_POLICY);
    expect(ttl).toContain("odrl:");
    const parsed = await parsePolicy(ttl);
    expect(parsed).toBeDefined();
    expect(parsed?.id).toBe(RICH_POLICY.id);
    expect(parsed?.type).toBe("Offer");
    expect(parsed?.conflict).toBe("prohibit");
    expect(parsed?.permissions?.length).toBe(1);
    expect(parsed?.permissions?.[0]?.action).toBe("read");
    expect(parsed?.permissions?.[0]?.target).toBe(RESOURCE);
    expect(parsed?.permissions?.[0]?.assignee).toBe(AGENT);
    expect(parsed?.permissions?.[0]?.constraints?.length).toBe(2);
    expect(parsed?.permissions?.[0]?.duties?.length).toBe(1);
    expect(parsed?.permissions?.[0]?.duties?.[0]?.action).toBe("attribute");
    expect(parsed?.prohibitions?.[0]?.action).toBe("distribute");
    expect(parsed?.obligations?.[0]?.action).toBe("inform");
  });

  // SECURITY TIGHTENING (jeswr/sparq#890): the `append`/`control` actions are backed
  // by the standard acl: mode IRIs (OAC practice) and must round-trip losslessly.
  it("round-trips the `append` + `control` actions via the standard acl: IRIs", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/acl",
      permissions: [
        { type: "permission", action: "append", target: RESOURCE, assignee: AGENT },
        { type: "permission", action: "control", target: RESOURCE, assignee: OWNER },
      ],
    };
    // Express: the action object IRIs are the real acl:Append / acl:Control, NOT odrl:.
    const quads = policyToRdf(policy);
    const actionObjs = quads
      .filter((q) => q.predicate.value === `${ODRL}action`)
      .map((q) => q.object.value);
    expect(actionObjs).toContain(`${ACL}Append`);
    expect(actionObjs).toContain(`${ACL}Control`);
    expect(actionObjs).not.toContain(`${ODRL}modify`);
    expect(actionObjs).not.toContain(`${ODRL}use`);
    // Parse back: the short names survive.
    const parsed = await parsePolicy(await policyToTurtle(policy));
    const actions = (parsed?.permissions ?? []).map((p) => p.action).sort();
    expect(actions).toEqual(["append", "control"]);
  });

  it("preserves a numeric (count) constraint as a number", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/count",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [{ leftOperand: "count", operator: "lteq", rightOperand: 5 }],
        },
      ],
    };
    const ttl = await policyToTurtle(policy);
    const parsed = await parsePolicy(ttl);
    const c = parsed?.permissions?.[0]?.constraints?.[0];
    expect(c?.rightOperand).toBe(5);
    expect(typeof c?.rightOperand).toBe("number");
  });

  it("preserves an IRI-valued (recipient) constraint as an IRI", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/recip",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [{ leftOperand: "recipient", operator: "eq", rightOperand: AGENT }],
        },
      ],
    };
    const ttl = await policyToTurtle(policy);
    // The recipient is written as an IRI object, not a quoted literal.
    expect(ttl).toContain(`<${AGENT}>`);
    const parsed = await parsePolicy(ttl);
    expect(parsed?.permissions?.[0]?.constraints?.[0]?.rightOperand).toBe(AGENT);
  });

  it("round-trips a set-valued (isAnyOf) constraint", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/any",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [
            {
              leftOperand: "purpose",
              operator: "isAnyOf",
              rightOperand: ["https://w3id.org/dpv#A", "https://w3id.org/dpv#B"],
            },
          ],
        },
      ],
    };
    const ttl = await policyToTurtle(policy);
    const parsed = await parsePolicy(ttl);
    const ro = parsed?.permissions?.[0]?.constraints?.[0]?.rightOperand;
    expect(Array.isArray(ro)).toBe(true);
    expect((ro as string[]).sort()).toEqual(["https://w3id.org/dpv#A", "https://w3id.org/dpv#B"]);
  });
});

describe("JSON-LD round-trip", () => {
  it("emits a self-contained inline @context and round-trips via parse", async () => {
    const doc = policyToJsonLd(RICH_POLICY);
    expect(doc["@context"]).toBeDefined();
    // No bare remote @context string — the context is the inline object.
    expect(typeof doc["@context"]).toBe("object");
    const parsed = await parsePolicy(JSON.stringify(doc), "application/ld+json");
    expect(parsed?.id).toBe(RICH_POLICY.id);
    expect(parsed?.type).toBe("Offer");
    expect(parsed?.permissions?.[0]?.action).toBe("read");
    expect(parsed?.prohibitions?.[0]?.action).toBe("distribute");
  });
});

describe("policyFromRdf edge cases", () => {
  it("returns undefined for a graph with no policy", async () => {
    const parsed = await parsePolicy("<a> <b> <c> .");
    expect(parsed).toBeUndefined();
  });

  it("defaults an untyped-subtype policy to Set", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/plain",
      permissions: [{ type: "permission", action: "use", target: RESOURCE }],
    };
    const parsed = await parsePolicy(await policyToTurtle(policy));
    expect(parsed?.type).toBe("Set");
  });

  it("drops a rule with an unrecognised action concept (round-trip safety)", async () => {
    // A hand-written graph whose rule action is not a known ODRL action.
    const ttl = `
      @prefix odrl: <${ODRL}> .
      <https://x/p> a odrl:Set ; odrl:permission [ odrl:action <https://x/unknownAction> ; odrl:target <https://x/r> ] .
    `;
    const parsed = await parsePolicy(ttl);
    // The policy parses but the unrecognised-action rule is dropped.
    expect(parsed?.id).toBe("https://x/p");
    expect(parsed?.permissions ?? []).toEqual([]);
  });

  it("policyFromRdf reads from an already-parsed dataset", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/ds",
      type: "Agreement",
      permissions: [{ type: "permission", action: "read", target: RESOURCE, assignee: AGENT }],
    };
    const dataset = await parseRdf(await policyToTurtle(policy), "text/turtle", {});
    const parsed = policyFromRdf(dataset);
    expect(parsed?.id).toBe(policy.id);
    expect(parsed?.type).toBe("Agreement");
    expect(parsed?.permissions?.[0]?.assignee).toBe(AGENT);
  });

  it("neutralises a hostile IRI in a target — no triple injection via policyToTurtle (adversarial-verify High)", async () => {
    // A rule target carrying a `>` + spaces would break out of the <…> that
    // n3.Writer emits verbatim and inject arbitrary triples. The write path must
    // percent-escape it so exactly the intended triples are emitted.
    const hostileTarget =
      "https://res.example/r> <https://evil/s> <https://evil/p> <https://evil/o> .\n<https://x";
    const ttl = await policyToTurtle({
      id: "https://alice.example/policies/inj",
      type: "Agreement",
      assigner: OWNER,
      permissions: [{ type: "permission", action: "read", target: hostileTarget, assignee: AGENT }],
    });
    // The `>` breakout char survives only percent-escaped, so the hostile value
    // stays inside ONE `odrl:target` object IRI.
    expect(ttl).toContain("%3E");
    // The graph parses to a single well-formed policy with exactly one permission —
    // an injection would have manufactured extra rules/triples. The escaped target
    // is the percent-encoded lexical form (an RDF parser does not percent-DECODE),
    // so it is inert and never re-widens.
    const parsed = await parsePolicy(ttl);
    expect(parsed?.permissions?.length).toBe(1);
    const t = parsed?.permissions?.[0]?.target ?? "";
    expect(t).not.toMatch(/[<> ]/); // no raw breakout chars survive in the parsed IRI
    expect(t).toContain("%3E");
  });
});
