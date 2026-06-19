// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public-surface sanity: the package's index re-exports the documented API, and
// the vocab constants are the REAL W3C ODRL IRIs.

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { ACL, ODRL } from "../src/vocab.js";

/** The Solid-resource access concepts backed by the standard `acl:` mode IRIs. */
const ACL_BACKED_ACTIONS = new Set(["append", "control"]);

describe("public API surface", () => {
  it("exports the express / parse / evaluate / compose entry points", () => {
    for (const name of [
      "policyToRdf",
      "policyToTurtle",
      "policyToJsonLd",
      "parsePolicy",
      "policyFromRdf",
      "evaluate",
      "constraintSatisfied",
      "serialize",
      "requestContextFromA2AIntent",
      "requestContextFromWac",
    ] as const) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("uses the canonical W3C ODRL 2.2 namespace", () => {
    expect(ODRL).toBe("http://www.w3.org/ns/odrl/2/");
    expect(api.ODRL).toBe("http://www.w3.org/ns/odrl/2/");
  });

  it("exposes the closed action / operator / left-operand / conflict enums", () => {
    expect(api.ODRL_ACTIONS).toContain("read");
    expect(api.OPERATORS).toContain("isAnyOf");
    expect(api.LEFT_OPERANDS).toContain("purpose");
    expect(api.CONFLICT_STRATEGIES).toEqual(["perm", "prohibit", "invalid"]);
  });

  it("maps every action short name to a real standard IRI (ODRL, or acl: for the Solid access concepts)", () => {
    for (const a of api.ODRL_ACTIONS) {
      if (ACL_BACKED_ACTIONS.has(a)) {
        // `append`/`control` reuse the standard `acl:` mode IRIs (OAC practice;
        // nothing minted) — they are NOT in the ODRL namespace, deliberately.
        expect(api.ACTION_IRI[a]).toContain(ACL);
        expect(api.ACTION_IRI[a]).not.toContain(ODRL);
      } else {
        expect(api.ACTION_IRI[a]).toContain(ODRL);
      }
    }
  });

  it("backs `append`/`control` with the exact standard acl: mode IRIs (not minted)", () => {
    expect(api.ACTION_IRI.append).toBe(`${ACL}Append`);
    expect(api.ACTION_IRI.control).toBe(`${ACL}Control`);
  });
});
