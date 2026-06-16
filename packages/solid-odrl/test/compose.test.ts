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
    expect(requestContextFromWac(BOB, "Append", RES).action).toBe("modify");
    expect(requestContextFromWac(BOB, "Control", RES).action).toBe("use");
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
