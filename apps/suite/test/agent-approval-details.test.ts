// AUTHORED-BY Codex GPT-6.1-Sol
import type { Mandate } from "@jeswr/agent-mandate";
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { AGENT } from "@jeswr/agent-mandate/verify";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvalExplanation,
  approvalKind,
  expiredApprovals,
  previewParts,
} from "../src/apps/agent/lib/approval-details";

const now = new Date("2026-11-01T12:00:00Z");
const proposal = {
  ...exampleRecords["action-proposal"],
  intent: {
    ...exampleRecords["action-proposal"].intent,
    action: `${AGENT}Remember`,
    recipientHash: `sha256:${"a".repeat(64)}`,
  },
};
const mandate = (): Mandate =>
  defaultMandate({
    id: "urn:permissions",
    ownerWebId: "https://owner.example/#me",
    agentWebId: "https://agent.example/#me",
    recipientHashes: [proposal.intent.recipientHash],
    now,
  });
afterEach(() => vi.useRealTimers());

it.each([
  ["SendMessage", "send"],
  ["BookAppointment", "book"],
  ["Transfer", "pay"],
  ["Remember", "remember"],
  ["Connect", "connect"],
])("displays the canonical %s kind as %s without rewriting its signed action", (action, kind) => {
  expect(approvalKind(`${AGENT}${action}`)).toBe(kind);
  expect(approvalKind(kind)).toBe(kind);
});
it.each([
  "urn:unknown:action",
  "__proto__",
  "toString",
])("gives unknown action %s a plain label", (action) =>
  expect(approvalKind(action)).toBe("Another action"));
it.each([
  "",
  "Chat text\n  with whitespace and <script>literal markup</script>",
  "Subject: A\r\nTo: Alice\r\n\r\nFull body\r\n\r\n— Sent by an agent · https://jeswr.org/agent · spec: https://jeswr.org/agentic-web\r\n",
  "— Sent by an agent · https://jeswr.org/agent",
  "Body\n— Sent by an agent · https://jeswr.org/agent\n",
  "Body\nSent by a person",
  "Body\n— Sent by an agent · https://jeswr.org/agent\nThis is still the body",
])("preserves every preview character: %s", (text) => {
  const parts = previewParts(text);
  expect(parts.text + parts.footer).toBe(text);
  expect(parts.footer.length > 0).toBe(
    text.includes("https://jeswr.org/agent") && !text.endsWith("body"),
  );
});

describe("verified permission explanations", () => {
  it("identifies the matching approval rule, ignoring the proposal author's rule claim", async () => {
    const m = mandate();
    const rule = { type: "permission" as const, action: `${AGENT}Remember` };
    const explained = await approvalExplanation(
      {
        ...m,
        withApproval: {
          ...m.withApproval,
          permissions: [{ ...rule, action: `${AGENT}SendMessage` }, rule],
        },
      },
      {
        ...proposal,
        intent: { ...proposal.intent, parameters: { approvalRule: "Always allowed" } },
      },
      now,
    );
    expect(explained).toMatchObject({
      reason: "Your permissions require approval for this action",
      rule: "Ask first · rule 2",
    });
    expect(JSON.parse(explained.ruleDetails as string)).toEqual({
      policy: m.withApproval.id,
      rules: [rule],
    });
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(
      await approvalExplanation(
        { ...m, withApproval: { ...m.withApproval, permissions: [rule] } },
        proposal,
      ),
    ).toMatchObject({
      rule: expect.stringContaining("Ask first · rule"),
    });
  });
  it("explains absent, expired, future, prohibited, indeterminate, autonomous and unmatched policies", async () => {
    const m = mandate();
    const allow = { type: "permission" as const, action: `${AGENT}Remember` };
    const cases: [Mandate | undefined, string][] = [
      [undefined, "Your agent has no verified permissions"],
      [{ ...m, validUntil: now.toISOString() }, "Your agent's permissions have expired"],
      [
        { ...m, validFrom: new Date(now.getTime() + 1).toISOString() },
        "Your agent's permissions have not started yet",
      ],
      [
        { ...m, prohibitions: [{ ...allow, type: "prohibition" }] },
        "Your permissions never allow this",
      ],
      [
        { ...m, withApproval: { ...m.withApproval, obligations: [{ action: "attribute" }] } },
        "Your permissions could not confirm this action",
      ],
      [
        { ...m, autonomous: { ...m.autonomous, permissions: [allow] } },
        "This request still needs your approval",
      ],
      [
        { ...m, withApproval: { id: "urn:ask" } },
        "No permission allows this action without asking",
      ],
    ];
    for (const [policy, reason] of cases)
      expect(await approvalExplanation(policy, proposal, now)).toEqual({ reason, rule: reason });
  });
});

it("moves unresolved expired proposals to Activity, newest expiry first, without inventing audit entries", () => {
  const at = (offset: number) => new Date(now.getTime() + offset).toISOString();
  const expired = { ...proposal, validUntil: at(-1) };
  const older = { ...expired, id: "urn:older", state: "expired" as const, validUntil: at(-100) };
  expect(
    expiredApprovals(
      [
        older,
        expired,
        { ...expired, id: "urn:approved", state: "approved" },
        { ...expired, id: "urn:sent", state: "sent" },
        { ...expired, id: "urn:denied", state: "denied" },
        { ...expired, id: "urn:failed", state: "failed" },
        { ...expired, id: "urn:future", validUntil: at(1) },
        { ...expired, id: "urn:outbox" },
      ],
      [
        { ...exampleRecords.transmission, proposal: "urn:outbox" },
        { ...exampleRecords.transmission, proposal: "urn:unrelated" },
      ],
      now.getTime(),
    ).map((p) => p.id),
  ).toEqual([expired.id, "urn:approved", older.id]);
});
