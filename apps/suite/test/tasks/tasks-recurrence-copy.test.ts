// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { humanise, type RecurrenceRule, weekdays } from "../../src/apps/tasks/lib/model/recurrence";

it("matches the exact §7 recurrence copy", () => {
  const due = new Date(2026, 10, 3, 9);
  const rules: RecurrenceRule[] = [
    { frequency: "DAILY" },
    { frequency: "WEEKLY", byDay: weekdays.slice(0, 5) },
    { frequency: "WEEKLY", byDay: ["Monday", "Wednesday"] },
    { frequency: "WEEKLY", interval: 2, byDay: ["Friday"] },
    { frequency: "MONTHLY", byMonthDay: 15 },
    { frequency: "YEARLY" },
    { frequency: "DAILY", until: new Date(2027, 0, 1) },
    { frequency: "DAILY", until: "2027-01-01" },
    { frequency: "DAILY", count: 10 },
  ];
  expect(rules.map((rule) => humanise(rule, due))).toMatchInlineSnapshot(`
    [
      "Every day",
      "Every weekday",
      "Every week on Mon, Wed",
      "Every 2 weeks on Fri",
      "Every month on the 15th",
      "Every year on 3 Nov",
      "Every day until 1 Jan 2027",
      "Every day until 1 Jan 2027",
      "Every day (10 times)",
    ]
  `);
});
