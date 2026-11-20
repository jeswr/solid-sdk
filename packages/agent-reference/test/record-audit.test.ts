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

const audit = (entries: readonly LedgerEntry[], evaluate: ReleaseEvaluator) =>
  auditReleases(entries, evaluate, { head: entries.at(-1) });

describe("record audit", () => {
  it("judges an autonomous release inside the mandate", async () => {
    const report = await audit(ledger(decision("use"), check, go), evaluate);
    expect(report.chain).toBe("intact");
    expect(report.judged.map((r) => [r.verdict, r.reason])).toEqual([["inside", "within-mandate"]]);
    expect(report.outside).toEqual([]);
  });

  it("does not clear a release from an unverified approval row or reuse an approval", async () => {
    const approval = {
      type: "approval",
      id: "urn:test:approval",
      actionDigest: actionDigest(intent("pay")),
      decision: "approve",
    };
    const approved = decision("pay", { basis: "owner-approval", approval: approval.id });
    const entries = ledger(approval, approved, check, go, approved, check, go);
    expect((await audit(entries, evaluate)).judged[0]?.verdict).toBe("indeterminate");
    const verified = await auditReleases(entries, evaluate, {
      head: entries.at(-1),
      verifyApproval: async () => true,
    });
    expect(verified.judged.map(({ verdict }) => verdict)).toEqual(["inside", "outside"]);
    const invalid = await auditReleases(entries, evaluate, {
      head: entries.at(-1),
      verifyApproval: async () => false,
    });
    expect(invalid.judged[0]?.verdict).toBe("outside");
    expect(
      (
        await auditReleases(entries.slice(0, -1), evaluate, {
          head: entries.at(-1),
        })
      ).chain,
    ).toBe("broken");
  });

  it("finds a release outside the mandate from the record alone, recorded as permit, without any marker", async () => {
    const entries = ledger(decision("use"), check, go, decision("transfer"), check, go);
    expect(entries.some((e) => "standIn" in e.record)).toBe(false);
    const report = await audit(entries, evaluate);
    expect(report.outside).toHaveLength(1);
    expect(report.outside[0]).toMatchObject({
      verdict: "outside",
      recorded: "permit",
      recomputed: "deny",
      actionDigest: actionDigest(intent("transfer")),
      decision: { seq: 4 },
      release: { seq: 6 },
    });
    expect(report.outside[0]?.release.hash).toBe((entries[5] as LedgerEntry).hash);
  });

  it("reports a release whose named mandate is not held as indeterminate", async () => {
    const report = await audit(
      ledger(decision("use", { policy: { ...mandate, digest: "sha-256:other" } }), check, go),
      evaluate,
    );
    expect(report.judged[0]).toMatchObject({
      verdict: "indeterminate",
      reason: "record-unavailable",
    });
    expect(report.outside).toHaveLength(1);
  });

  it("counts a release with no authorisation decision as unjudged", async () => {
    const report = await audit(
      ledger({ ...check, verdict: "not-applicable" }, go, decision("use"), check, go),
      evaluate,
    );
    expect(report.unjudged).toHaveLength(1);
    expect(report.unjudged[0]?.checks).toEqual(["mandate:not-applicable"]);
    expect(report.judged).toHaveLength(1);
  });

  it("refuses to judge a broken chain", async () => {
    const entries = ledger(decision("transfer"), check, go).map((e) => ({ ...e }));
    entries[1] = { ...(entries[1] as LedgerEntry), record: { ...check, verdict: "fail" } };
    const report = await audit(entries, evaluate);
    expect(report.chain).toBe("broken");
    expect(report.judged).toEqual([]);
  });
});
