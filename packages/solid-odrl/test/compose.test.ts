// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Composition tests: an ODRL policy gating an @jeswr/solid-a2a intent, and an
// ODRL policy attached to a Solid resource evaluated for a WAC-mode request.

import { describe, expect, it } from "vitest";
import {
  A2A_ACTION_TO_ODRL,
  requestContextFromA2AIntent,
  requestContextFromWac,
} from "../src/compose.js";
import { evaluate } from "../src/evaluate.js";
import type { OdrlPolicy } from "../src/types.js";

const OWNER = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const RES = "https://alice.example/notes/private.ttl";

describe("requestContextFromA2AIntent", () => {
  it("maps A2A verbs onto ODRL actions", () => {
    expect(A2A_ACTION_TO_ODRL.read).toBe("read");
    expect(A2A_ACTION_TO_ODRL.create).toBe("write");
    expect(A2A_ACTION_TO_ODRL.update).toBe("modify");
    expect(A2A_ACTION_TO_ODRL.delete).toBe("delete");
  });

  // SECURITY TIGHTENING (jeswr/sparq#890): `append` is add-only (acl:Append is a
  // STRICT subclass of write). Mapping it to `modify` over-granted full mutation.
  it("maps the A2A append verb to the narrow `append` action, NOT `modify` (no over-grant)", () => {
    expect(A2A_ACTION_TO_ODRL.append).toBe("append");
    // mutation-proof: the OLD over-grant value is now wrong.
    expect(A2A_ACTION_TO_ODRL.append).not.toBe("modify");
  });

  it("an A2A append intent does NOT match a `modify` permission (the old over-grant is gone)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      // owner permits ONLY modify (full mutation), not add-only append.
      permissions: [{ type: "permission", action: "modify", target: RES, assignee: BOB }],
    };
    const ctxAppend = requestContextFromA2AIntent({ action: "append", target: RES, agent: BOB });
    // Pre-tightening this returned action "modify" → permit. Now it is "append" →
    // the modify permission does not cover it → notApplicable (no over-grant).
    expect(ctxAppend.action).toBe("append");
    expect(evaluate(policy, ctxAppend).decision).toBe("notApplicable");
    // Sanity: an actual modify request still permits.
    const ctxModify = requestContextFromA2AIntent({ action: "update", target: RES, agent: BOB });
    expect(evaluate(policy, ctxModify).decision).toBe("permit");
  });

  it("an A2A append intent IS matched by an explicit `append` permission", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "append", target: RES, assignee: BOB }],
    };
    const ctx = requestContextFromA2AIntent({ action: "append", target: RES, agent: BOB });
    expect(evaluate(policy, ctx).decision).toBe("permit");
  });

  // SECURITY TIGHTENING (jeswr/sparq#890, surfaced by roborev): an A2A `grant` intent
  // CHANGES ACCESS CONTROL — it must not be authorized by a broad data-`use` policy.
  it("maps the A2A grant verb to `control`, NOT `use` (no ACL over-grant)", () => {
    expect(A2A_ACTION_TO_ODRL.grant).toBe("control");
    expect(A2A_ACTION_TO_ODRL.grant).not.toBe("use");
  });

  it("a broad `use` data-use permission does NOT authorize an A2A grant intent", () => {
    const policy: OdrlPolicy = {
      id: "p",
      // a broad "permit all data use" permission.
      permissions: [{ type: "permission", action: "use", target: RES, assignee: BOB }],
    };
    const grantCtx = requestContextFromA2AIntent({
      action: "grant",
      target: RES,
      agent: BOB,
      recipient: OWNER,
    });
    // Pre-tightening: grant → use → permit (WRONG — a data policy authorizing an ACL
    // grant). Now: grant → control, outside the use umbrella → notApplicable.
    expect(grantCtx.action).toBe("control");
    expect(evaluate(policy, grantCtx).decision).toBe("notApplicable");
    // A genuine data-use request (read) IS still covered by `use`.
    const readCtx = requestContextFromA2AIntent({ action: "read", target: RES, agent: BOB });
    expect(evaluate(policy, readCtx).decision).toBe("permit");
  });

  it("an A2A grant intent IS matched by an explicit `control` permission", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "control", target: RES, assignee: BOB }],
    };
    const ctx = requestContextFromA2AIntent({
      action: "grant",
      target: RES,
      agent: BOB,
      recipient: OWNER,
    });
    expect(evaluate(policy, ctx).decision).toBe("permit");
  });

  it("falls back to the use umbrella for an unknown verb", () => {
    const ctx = requestContextFromA2AIntent({ action: "frobnicate", target: RES, agent: BOB });
    expect(ctx.action).toBe("use");
  });

  it("an ODRL policy gates an A2A read intent end-to-end", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "read", target: RES, assignee: BOB }],
    };
    const ctx = requestContextFromA2AIntent({ action: "read", target: RES, agent: BOB });
    expect(evaluate(policy, ctx).decision).toBe("permit");

    const ctxOther = requestContextFromA2AIntent({ action: "create", target: RES, agent: BOB });
    // create → write, which the read permission does not cover.
    expect(evaluate(policy, ctxOther).decision).toBe("notApplicable");
  });

  it("carries a grant intent's recipient into the request attributes", () => {
    const ctx = requestContextFromA2AIntent({
      action: "grant",
      target: RES,
      agent: BOB,
      recipient: OWNER,
    });
    expect(ctx.attributes?.recipient).toBe(OWNER);
  });

  it("merges caller-supplied attributes (purpose/time)", () => {
    const ctx = requestContextFromA2AIntent(
      { action: "read", target: RES, agent: BOB },
      { purpose: "https://w3id.org/dpv#Research" },
    );
    expect(ctx.attributes?.purpose).toBe("https://w3id.org/dpv#Research");
  });
});

describe("requestContextFromWac", () => {
  it("maps WAC modes onto ODRL actions", () => {
    expect(requestContextFromWac(BOB, "Read", RES).action).toBe("read");
    expect(requestContextFromWac(BOB, "Write", RES).action).toBe("write");
    // SECURITY TIGHTENING (jeswr/sparq#890): Append → `append` (NOT `modify`),
    // Control → `control` (NOT `use`). See vocab.ts ACL_MODE_TO_ACTION.
    expect(requestContextFromWac(BOB, "Append", RES).action).toBe("append");
    expect(requestContextFromWac(BOB, "Control", RES).action).toBe("control");
  });

  // --- mutation-proof: the OLD over-grant mapping would now fail ----------------
  it("Append does NOT map to `modify`/Write (the old over-grant is gone)", () => {
    const action = requestContextFromWac(BOB, "Append", RES).action;
    expect(action).not.toBe("modify");
    expect(action).not.toBe("write");
  });

  it("Control does NOT map to a data-`use` grant (the old over-grant is gone)", () => {
    const action = requestContextFromWac(BOB, "Control", RES).action;
    expect(action).not.toBe("use");
    expect(action).not.toBe("read");
    expect(action).not.toBe("write");
  });

  // --- end-to-end: the tightening never broadens an Append/Control request ------
  it("a WAC Append request does NOT match a `modify` permission (no over-grant)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      // owner permits full modify, but NOT add-only append.
      permissions: [{ type: "permission", action: "modify", target: RES, assignee: BOB }],
    };
    const ctx = requestContextFromWac(BOB, "Append", RES);
    // Pre-tightening: Append → modify → permit (WRONG). Now: Append → append →
    // the modify permission does not cover it → notApplicable.
    expect(evaluate(policy, ctx).decision).toBe("notApplicable");
  });

  it("a WAC Append request IS matched by an explicit `append` permission", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "append", target: RES, assignee: BOB }],
    };
    expect(evaluate(policy, requestContextFromWac(BOB, "Append", RES)).decision).toBe("permit");
  });

  // WAC subsumption (roborev finding 2): acl:Append IS a subclass of acl:Write, so a
  // `write` permission must also satisfy an Append request (a STRONGER grant covers
  // the WEAKER request — strictly safe; the reverse is NOT true).
  it("a WAC Append request IS matched by a `write` permission (write ⊇ append)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "write", target: RES, assignee: BOB }],
    };
    expect(evaluate(policy, requestContextFromWac(BOB, "Append", RES)).decision).toBe("permit");
  });

  it("an `append` permission does NOT cover a WAC Write request (subsumption is one-way)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "append", target: RES, assignee: BOB }],
    };
    // append must NEVER cover write/modify — that was the original over-grant.
    expect(evaluate(policy, requestContextFromWac(BOB, "Write", RES)).decision).toBe(
      "notApplicable",
    );
    const modifyPolicy: OdrlPolicy = {
      id: "p2",
      permissions: [{ type: "permission", action: "append", target: RES, assignee: BOB }],
    };
    expect(evaluate(modifyPolicy, { action: "modify", target: RES, agent: BOB }).decision).toBe(
      "notApplicable",
    );
  });

  it("a WAC Control request does NOT match a broad `use` data-use permission (no over-grant)", () => {
    const policy: OdrlPolicy = {
      id: "p",
      // a broad "permit all data use" permission.
      permissions: [{ type: "permission", action: "use", target: RES, assignee: BOB }],
    };
    const ctx = requestContextFromWac(BOB, "Control", RES);
    // Pre-tightening: Control → use → permit (WRONG — would grant ACL control via a
    // data-use policy). Now: Control → control, which the `use` umbrella does NOT
    // cover → notApplicable.
    expect(evaluate(policy, ctx).decision).toBe("notApplicable");
    // And a genuine data-use request (e.g. read) IS still covered by `use`.
    expect(evaluate(policy, requestContextFromWac(BOB, "Read", RES)).decision).toBe("permit");
  });

  it("a WAC Control request IS matched by an explicit `control` permission", () => {
    const policy: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "control", target: RES, assignee: BOB }],
    };
    expect(evaluate(policy, requestContextFromWac(BOB, "Control", RES)).decision).toBe("permit");
  });

  it("`control` is NOT covered by the `use` umbrella; `append` IS (ACTION_IMPLIED_BY)", () => {
    // control is its own island — only a `control` rule matches a control request.
    const useOnly: OdrlPolicy = {
      id: "p",
      permissions: [{ type: "permission", action: "use", target: RES, assignee: BOB }],
    };
    expect(evaluate(useOnly, { action: "control", target: RES, agent: BOB }).decision).toBe(
      "notApplicable",
    );
    // append, being a data-access mode, IS covered by the use umbrella (this does not
    // broaden vs. the old behaviour — `use` always covered everything).
    expect(evaluate(useOnly, { action: "append", target: RES, agent: BOB }).decision).toBe(
      "permit",
    );
  });

  it("an ODRL policy attached to a resource evaluates a WAC Read request", () => {
    const policy: OdrlPolicy = {
      id: "p",
      assigner: OWNER,
      permissions: [
        {
          type: "permission",
          action: "read",
          target: RES,
          assignee: BOB,
          constraints: [
            {
              leftOperand: "purpose",
              operator: "eq",
              rightOperand: "https://w3id.org/dpv#Research",
            },
          ],
        },
      ],
    };
    const ctx = requestContextFromWac(BOB, "Read", RES, {
      purpose: "https://w3id.org/dpv#Research",
    });
    expect(evaluate(policy, ctx).decision).toBe("permit");
  });

  it("handles an anonymous (no-agent) WAC request", () => {
    const ctx = requestContextFromWac(undefined, "Read", RES);
    expect(ctx.agent).toBeUndefined();
    expect(ctx.action).toBe("read");
    expect(ctx.target).toBe(RES);
  });
});
