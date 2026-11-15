// AUTHORED-BY Claude Opus 5.5
// Brief 32 test 5: the record audit on synthetic ledgers.
import { describe, expect, it } from "vitest";
import type { ActionIntent, AuthorisationDecision } from "../src/core/types.js";
import { actionDigest } from "../src/mechanisms/mandate.js";
import { auditReleases, type ReleaseEvaluator } from "../src/mechanisms/record-audit.js";
import { type LedgerEntry, MemoryLedger } from "../src/store/ledger.js";

const at = "2026-11-13T09:00:00.000Z";
const mandate = { id: "urn:test:mandate", digest: "sha-256:mandate", evaluator: "test" };
const intent = (action: string): ActionIntent =>
  ({
    action,
    target: `urn:test:${action}`,
    operation: "urn:test:op",
    recipient: "urn:test:peer",
    purpose: "urn:test:purpose",
    conversation: "urn:test:conversation",
    parameters: {},
  }) as unknown as ActionIntent;
const decision = (action: string, extra: object = {}) => ({
  type: "authorisation-decision",
  decider: "urn:test:agent",
  actionDigest: actionDigest(intent(action)),
  action: intent(action),
  policy: mandate,
  outcome: "permit",
  reason: "within-mandate",
  at,
  ...extra,
});
const check = { type: "gate-check", gate: "outbound-gate", check: "mandate", verdict: "pass" };
const go = { type: "gate-decision", gate: "outbound-gate", outcome: "go", checks: [] };
const ledger = (...records: object[]) => {
  const l = new MemoryLedger();
  for (const record of records) l.append(record as { type: string }, at);
  return l.entries();
};
/** The mandate: `use` is autonomous, `pay` needs approval, anything else is denied. */
const evaluate: ReleaseEvaluator = (action, _at, named) =>
  named.digest !== mandate.digest
    ? undefined
    : ({
        outcome:
          action.action === "use"
            ? "permit"
            : action.action === "pay"
              ? "approval-required"
              : "deny",
      } as AuthorisationDecision);

describe("record audit", () => {
  it("judges an autonomous release inside the mandate", () => {
    const audit = auditReleases(ledger(decision("use"), check, go), evaluate);
    expect(audit.chain).toBe("intact");
    expect(audit.judged.map((r) => [r.verdict, r.reason])).toEqual([["inside", "within-mandate"]]);
    expect(audit.outside).toEqual([]);
  });

  it("judges an approved release inside only with a recorded approval for that digest", () => {
    const approval = {
      type: "approval",
      id: "urn:test:approval",
      actionDigest: actionDigest(intent("pay")),
      decision: "approve",
    };
    const approved = auditReleases(
      ledger(
        approval,
        decision("pay", { basis: "owner-approval", approval: approval.id }),
        check,
        go,
      ),
      evaluate,
    );
    expect(approved.judged[0]?.verdict).toBe("inside");
    const elsewhere = auditReleases(
      ledger(
        { ...approval, actionDigest: actionDigest(intent("use")) },
        decision("pay", { basis: "owner-approval", approval: approval.id }),
        check,
        go,
      ),
      evaluate,
    );
    expect(elsewhere.judged[0]).toMatchObject({ verdict: "outside", reason: "not-authorised" });
  });

  it("finds a release outside the mandate from the record alone, recorded as permit, without any marker", () => {
    const entries = ledger(decision("use"), check, go, decision("transfer"), check, go);
    expect(entries.some((e) => "standIn" in e.record)).toBe(false);
    const audit = auditReleases(entries, evaluate);
    expect(audit.outside).toHaveLength(1);
    expect(audit.outside[0]).toMatchObject({
      verdict: "outside",
      recorded: "permit",
      recomputed: "deny",
      actionDigest: actionDigest(intent("transfer")),
      decision: { seq: 4 },
      release: { seq: 6 },
    });
    expect(audit.outside[0]?.release.hash).toBe((entries[5] as LedgerEntry).hash);
  });

  it("reports a release whose named mandate is not held as indeterminate", () => {
    const audit = auditReleases(
      ledger(decision("use", { policy: { ...mandate, digest: "sha-256:other" } }), check, go),
      evaluate,
    );
    expect(audit.judged[0]).toMatchObject({
      verdict: "indeterminate",
      reason: "record-unavailable",
    });
    expect(audit.outside).toHaveLength(1);
  });

  it("counts a release with no authorisation decision as unjudged", () => {
    const audit = auditReleases(
      ledger({ ...check, verdict: "not-applicable" }, go, decision("use"), check, go),
      evaluate,
    );
    expect(audit.unjudged).toHaveLength(1);
    expect(audit.unjudged[0]?.checks).toEqual(["mandate:not-applicable"]);
    expect(audit.judged).toHaveLength(1);
  });

  it("refuses to judge a broken chain", () => {
    const entries = ledger(decision("transfer"), check, go).map((e) => ({ ...e }));
    entries[1] = { ...(entries[1] as LedgerEntry), record: { ...check, verdict: "fail" } };
    const audit = auditReleases(entries, evaluate);
    expect(audit.chain).toBe("broken");
    expect(audit.judged).toEqual([]);
  });
});
