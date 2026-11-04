// AUTHORED-BY Claude Opus 5.5
import { AGENT, type Limit } from "@jeswr/agent-mandate";
import { describe, expect, it } from "vitest";
import {
  actionCovers,
  actionWords,
  type Commitment,
  checkLimits,
  constraintWords,
  describeMandate,
  describePolicy,
  joinNames,
  limitWords,
  nameOf,
  shortName,
  standInJudge,
  verdict,
} from "../src/index.js";
import { periodStart } from "../src/limits.js";
import {
  CUSTOMERS,
  createWorld,
  customerPolicy,
  DIRECTORY,
  PURPOSE,
  supportMandate,
} from "../src/world/index.js";

const lim = (
  operand: string,
  rightOperand: number,
  enforcement: "hard" | "soft" = "hard",
  operator: string = "lteq",
): Limit => ({ leftOperand: `${AGENT}${operand}`, operator, rightOperand, enforcement }) as Limit;
const NOW = Date.parse("2026-11-04T12:00:00Z");
const send = (at: number, recipient = "mailto:a@x"): Commitment => ({
  at,
  kind: "send",
  recipient,
});
const pay = (at: number, value: number, currency = "GBP"): Commitment => ({
  at,
  kind: "pay",
  recipient: "urn:acct",
  amount: { value, currency },
});

describe("limits", () => {
  it("counts sends per UTC day and per recipient over a rolling day", () => {
    const history = [send(NOW - 3_600_000), send(Date.parse("2026-11-03T23:00:00Z"))];
    expect(
      checkLimits(
        [lim("sendsPerDay", 2)],
        "GBP",
        history,
        { kind: "send", recipients: ["mailto:b@x"] },
        NOW,
      ),
    ).toEqual([]);
    expect(
      checkLimits(
        [lim("sendsPerDay", 1)],
        "GBP",
        history,
        { kind: "send", recipients: ["mailto:b@x"] },
        NOW,
      ),
    ).toHaveLength(1);
    const per = checkLimits(
      [lim("perRecipientPerDay", 1, "soft")],
      "GBP",
      history,
      { kind: "send", recipients: ["mailto:a@x", "mailto:b@x"] },
      NOW,
    );
    expect(per).toEqual([
      {
        operand: "perRecipientPerDay",
        enforcement: "soft",
        used: 2,
        limit: 1,
        recipient: "mailto:a@x",
      },
    ]);
    expect(
      checkLimits(
        [lim("sendsPerDay", 0)],
        "GBP",
        history,
        { kind: "pay", recipients: [], amount: { value: 1, currency: "GBP" } },
        NOW,
      ),
    ).toEqual([]);
  });

  it("adds up spend per day, week and month in pence", () => {
    const history = [
      pay(NOW - 1000, 0.1),
      pay(NOW - 2000, 0.2),
      pay(Date.parse("2026-11-02T09:00:00Z"), 50),
      pay(NOW, 9, "EUR"),
    ];
    const c = (value: number) => ({
      kind: "pay" as const,
      recipients: ["urn:acct"],
      amount: { value, currency: "GBP" },
    });
    expect(checkLimits([lim("spendPerDay", 0.6)], "GBP", history, c(0.3), NOW)).toEqual([]);
    expect(checkLimits([lim("spendPerWeek", 50)], "GBP", history, c(1), NOW)).toHaveLength(1);
    expect(checkLimits([lim("spendPerMonth", 51)], "GBP", history, c(0.7), NOW)).toEqual([]);
    expect(
      checkLimits(
        [lim("spendPerDay", 100)],
        "GBP",
        [],
        { kind: "send", recipients: ["mailto:a@x"] },
        NOW,
      ),
    ).toEqual([]);
  });

  it("fails closed on anything it cannot check", () => {
    const c = {
      kind: "pay" as const,
      recipients: ["urn:acct"],
      amount: { value: 1, currency: "USD" },
    };
    expect(checkLimits([lim("spendPerDay", 100)], "GBP", [], c, NOW)[0]?.used).toBeNaN();
    expect(
      checkLimits([lim("spendPerDay", 100)], "GBP", [], { kind: "pay", recipients: [] }, NOW),
    ).toHaveLength(1);
    expect(
      checkLimits(
        [lim("sendsPerDay", 5, "hard", "gt")],
        "GBP",
        [],
        { kind: "send", recipients: [] },
        NOW,
      ),
    ).toHaveLength(1);
    expect(
      checkLimits([lim("sendsPerDay", -1)], "GBP", [], { kind: "send", recipients: [] }, NOW),
    ).toHaveLength(1);
    expect(
      checkLimits([lim("teleportsPerDay", 5)], "GBP", [], { kind: "send", recipients: [] }, NOW),
    ).toHaveLength(1);
    const foreign = {
      leftOperand: "https://example.org/x",
      operator: "lteq",
      rightOperand: 1,
      enforcement: "soft",
    } as Limit;
    expect(
      checkLimits([foreign], "GBP", [], { kind: "send", recipients: [] }, NOW)[0],
    ).toMatchObject({ operand: "https://example.org/x", enforcement: "soft" });
  });

  it("finds period starts", () => {
    expect(new Date(periodStart(NOW, "week")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(new Date(periodStart(NOW, "month")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("plain-English rules", () => {
  it("renders the mandate the gate enforces", () => {
    const text = describeMandate(supportMandate(), DIRECTORY);
    expect(text.onItsOwn).toContain("May read the customer records (CRM).");
    expect(text.never).toContain("May never delete the production database.");
    // An untargeted agent action drops its dangling "with".
    expect(text.never).toContain("May never sign agreements.");
    expect(text.limits).toEqual([
      "Send at most 5 messages a day; then it stops.",
      "Contact any one person at most 1 time in 24 hours; then it stops.",
      "Commit at most £200 a day; then it asks a person.",
    ]);
  });

  it("renders data policies, constraints, actions and limits", () => {
    const customer = CUSTOMERS[0];
    if (!customer) throw new Error("fixture");
    expect(describePolicy(customerPolicy(customer), DIRECTORY)).toContain(
      "Nobody may share or send on for marketing.",
    );
    expect(
      describePolicy(
        {
          id: "urn:p",
          assignee: "mailto:priya.shah@harbourfinch.example",
          permissions: [{ type: "permission", action: "read" }],
          prohibitions: [{ type: "prohibition", action: "delete" }],
          obligations: [{ action: "inform" }],
        },
        DIRECTORY,
      ),
    ).toEqual([
      "Priya Shah (support lead) may read.",
      "Priya Shah (support lead) may never delete.",
      "Whoever holds it must inform the owner of it.",
    ]);
    const w = (leftOperand: string, operator: string, rightOperand: unknown) =>
      constraintWords({ leftOperand, operator, rightOperand } as never, DIRECTORY);
    expect(w("purpose", "neq", PURPOSE.marketing)).toBe("except for marketing");
    expect(w("recipient", "isNoneOf", ["mailto:x@y"])).toBe("to anyone other than x@y");
    expect(w("spatial", "isNoneOf", ["urn:r"])).toBe("outside r");
    expect(w("dateTime", "lt", "2027-01-01")).toBe("until 2027-01-01");
    expect(w("dateTime", "gteq", "2026-01-01")).toBe("from 2026-01-01");
    expect(w("count", "lteq", 3)).toBe("at most 3 times");
    expect(w("systemDevice", "eq", "urn:laptop")).toBe("when system device eq laptop");
    expect(actionWords("http://www.w3.org/ns/odrl/2/read")).toBe("read");
    expect(actionWords("constructor")).toBe("constructor");
    expect(actionWords("https://example.org/act#launch")).toBe("launch");
    expect(limitWords(lim("spendPerWeek", 9), "EUR")).toBe(
      "Commit at most EUR 9 a week; then it stops.",
    );
    expect(limitWords(lim("spendPerMonth", 9, "soft"), "GBP")).toBe(
      "Commit at most £9 a month; then it asks a person.",
    );
    expect(limitWords(lim("perRecipientPerDay", 2), "GBP")).toMatch(/2 times/);
    expect(limitWords(lim("odd", 1), "GBP")).toBe("Limit odd at most 1; then it stops.");
  });

  it("names things", () => {
    expect(nameOf(DIRECTORY, "constructor")).toBe("constructor");
    expect(shortName("https://example.org/a/b/")).toBe("b");
    expect(shortName("mailto:sam@example.net")).toBe("sam@example.net");
    expect(joinNames([])).toBe("");
    expect(joinNames(["a", "b", "c"], "and")).toBe("a, b and c");
  });
});

describe("helpers", () => {
  it("ODRL action implication", () => {
    expect(actionCovers("use", "read")).toBe(true);
    expect(actionCovers("read", "use")).toBe(false);
    expect(actionCovers(`${AGENT}SendMessage`, "read")).toBe(false);
    expect(actionCovers("http://www.w3.org/ns/odrl/2/use", "distribute")).toBe(true);
  });

  it("verdicts", () => {
    expect(verdict("stop", "permit")).toBe("let-through");
    expect(verdict("permit", "review")).toBe("over-blocked");
    expect(verdict("review", "stop")).toBe("different");
  });

  it("the stand-in judge says what it is", async () => {
    expect(standInJudge.name).toMatch(/not a model/);
    expect(
      JSON.parse(await standInJudge.complete("You enforce", "Proposed action: Delete rows")),
    ).toMatchObject({ outcome: "stop" });
    expect(
      JSON.parse(
        await standInJudge.complete(
          "Classify",
          "Purposes:\n- urn:care (care)\n\nMessage:\nUpgrade now, 20% off",
        ),
      ),
    ).toEqual({ purpose: null });
  });

  it("the simulated tools validate their arguments", async () => {
    const world = createWorld();
    const tool = (name: string) => {
      const t = world.tools.find((x) => x.name === name);
      if (!t) throw new Error(name);
      return t;
    };
    expect(() =>
      tool("email_send").context?.({ to: ["not an address"], subject: "s", body: "b" }),
    ).toThrow(/email addresses/);
    expect(() => tool("email_send").context?.({ to: "a@b.c", subject: "", body: "b" })).toThrow(
      /non-empty/,
    );
    expect(() => tool("payments_refund").context?.({ customer: "c-1001", amount: "lots" })).toThrow(
      /number/,
    );
    expect(() => tool("crm_get_customer").context?.({ customer: "c-9999" })).toThrow(/no customer/);
    expect(() => tool("db_query").context?.({ sql: "DROP TABLE orders" })).toThrow(/read-only/);
    expect(await tool("hr_get_absence").run({ employee: "Priya" })).toEqual({
      content: "No recent absence.",
    });
    expect(await tool("crm_find_customers").run({})).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ name: "Aisha Khan" })]),
    });
    expect(await tool("tickets_update").run({ ticket: "T-482", status: "closed" })).toEqual({
      content: "Ticket T-482 is now closed.",
    });
    await expect(async () =>
      tool("tickets_update").run({ ticket: "T-1", status: "x" }),
    ).rejects.toThrow(/no such ticket/);
    expect(await tool("db_execute").run({ sql: "UPDATE x" })).toEqual({ content: "Executed." });
    expect(await tool("db_delete_rows").run({ table: "orders", where: "1=1" })).toEqual({
      content: "Deleted 3 rows.",
    });
    expect(await tool("marketing_send_campaign").run({ segment: "a", message: "m" })).toEqual({
      content: "Campaign sent.",
    });
    expect(tool("marketing_send_campaign").context?.({ segment: "a", message: "m" })).toMatchObject(
      { purpose: PURPOSE.marketing },
    );
    expect(
      tool("payments_refund").context?.({
        customer: "Maria Lopez",
        amount: 5,
        toAccount: "GB11 2233",
      }),
    ).toMatchObject({ recipients: ["urn:hf:account:GB112233"] });
    expect(
      tool("email_send").context?.({
        to: ["a@harbourfinch.example", "b@datahub.example"],
        subject: "s",
        body: "b",
      }),
    ).not.toHaveProperty("region");
  });
});
