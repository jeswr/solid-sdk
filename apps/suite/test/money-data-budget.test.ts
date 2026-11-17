// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { parseMoney as amount } from "../src/apps/money/lib/budget";
import { createAccount, listAccounts } from "../src/apps/money/lib/data/accounts";
import {
  budgetMonthBounds,
  budgetView,
  incomeCategoryIds,
  loadBudget,
  loadBudgetHistory,
  loadBudgetMonths,
  saveBudgetAssignments,
} from "../src/apps/money/lib/data/budget";
import { saveCategories } from "../src/apps/money/lib/data/categories";
import { provision, storeOf } from "../src/apps/money/lib/data/container";
import { addTransaction, createTransfer } from "../src/apps/money/lib/data/ledger";
import {
  MoneyDocument,
  MoneyIoError,
  parseMoney,
  serialiseMoney,
  type Transaction,
} from "../src/apps/money/lib/model";
import {
  BUDGET,
  BudgetNode,
  putBudget,
  readBudget,
  validateBudget,
} from "../src/apps/money/lib/model/budget";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { must } from "./money/helpers";

const root = "https://budget.example/";
const url = `${root}money/budgets/2026-11.ttl`;
const category = `${root}money/categories.ttl#food`;
const assignment = (decimal = "100", currency = "GBP", categoryId = category) => ({
  categoryId,
  amount: amount(currency, decimal),
});
function setup() {
  const pod = createDemoPod({ root, latency: 0 });
  const client = { storageUrl: root, fetch: pod.fetch };
  return { pod, client, store: storeOf(client) };
}
const budgetNode = (doc: MoneyDocument, id: string) =>
  new BudgetNode(DataFactory.namedNode(id), doc.dataset, DataFactory);

describe("monthly budget RDF", () => {
  it("updates foreign assignments in place and keeps omitted foreign memberships and metadata", async () => {
    const doc = new MoneyDocument();
    putBudget(doc, url, "2026-11", []);
    const root = budgetNode(doc, `${url}#budget`);
    const foreign = budgetNode(doc, `${url}#other-program-food`);
    foreign.budgetCategory = category;
    foreign.description = "Other program's metadata";
    const { putMoney } = await import("../src/apps/money/lib/model/rdf");
    foreign.amountNode = putMoney(doc, foreign.value, { amount: "100", currency: "GBP" });
    const amountId = foreign.amountNode;
    root.assignments.add(foreign.value);
    putBudget(doc, url, "2026-11", [assignment("80")]);
    expect([...root.assignments]).toEqual([foreign.value]);
    expect(foreign.amountNode).toEqual(amountId);
    expect(readBudget(doc, url, "2026-11")).toEqual([assignment("80")]);
    putBudget(doc, url, "2026-11", []);
    expect([...root.assignments]).toEqual([foreign.value]);
    const restored = await parseMoney(await serialiseMoney(doc), url);
    expect(readBudget(restored, url, "2026-11")).toEqual([assignment("80")]);
    expect(restored.node(foreign.value).description).toBe("Other program's metadata");
  });
  it("round trips, upserts memberships, reuses amounts and retains unrelated RDF", async () => {
    const doc = new MoneyDocument();
    doc.node(url).description = "Preserve this metadata";
    expect(readBudget(doc, url, "2026-11")).toEqual([]);
    const rows = [assignment("100"), assignment("300", "JPY")];
    putBudget(doc, url, "2026-11", rows);
    const text = await serialiseMoney(doc);
    expect(text).toContain("Budget");
    expect(text).toContain("MonetaryAmount");
    expect(text).toContain("hasPart");
    expect(text).toContain("about");
    expect(readBudget(await parseMoney(text, url), url, "2026-11")).toEqual(rows);
    const size = doc.dataset.size;
    putBudget(doc, url, "2026-11", [assignment("90"), assignment("200", "JPY")]);
    expect(doc.dataset.size).toBe(size);
    putBudget(doc, url, "2026-11", []);
    expect(readBudget(doc, url, "2026-11")).toEqual([assignment("90"), assignment("200", "JPY")]);
    expect(doc.node(url).description).toBe("Preserve this metadata");
    const node = budgetNode(doc, `${url}#budget`);
    node.month = undefined;
    node.budgetCategory = category;
    expect(node.budgetCategory).toBe(category);
    node.budgetCategory = undefined;
    expect(node.budgetCategory).toBeUndefined();
    expect(node.month).toBeUndefined();
  });
  it("rejects malformed roots, assignments, duplicate currencies and invalid months before mutation", () => {
    const doc = new MoneyDocument();
    expect(() => putBudget(doc, url, "2026-13", [assignment()])).toThrow();
    expect(doc.dataset.size).toBe(0);
    expect(() => validateBudget("2026-11", [assignment(), assignment()])).toThrow();
    expect(() => validateBudget("2026-11", [assignment("1", "GBP", "not-an-iri")])).toThrow();
    putBudget(doc, url, "2026-11", [assignment()]);
    expect(() => readBudget(doc, url, "2026-12")).toThrow("Invalid monthly");
    doc.node(`${url}#other`).types.add(BUDGET.type);
    expect(() => readBudget(doc, url, "2026-11")).toThrow("Invalid monthly");
    const other = new MoneyDocument();
    other.node(`${url}#other`).types.add(BUDGET.type);
    expect(() => readBudget(other, url, "2026-11")).toThrow("Invalid monthly");
    const clean = new MoneyDocument();
    putBudget(clean, url, "2026-11", [assignment()]);
    const id = [...budgetNode(clean, `${url}#budget`).assignments][0] as string;
    budgetNode(clean, id).budgetCategory = undefined;
    expect(() => readBudget(clean, url, "2026-11")).toThrow("Missing budget category");
    const decimal = new MoneyDocument();
    putBudget(decimal, url, "2026-11", [assignment()]);
    const owner = decimal.node([...budgetNode(decimal, `${url}#budget`).assignments][0] as string);
    decimal.node(owner.amountNode as NonNullable<typeof owner.amountNode>).amount = "10.500";
    expect(readBudget(decimal, url, "2026-11")[0]?.amount.minor).toBe(1050);
    decimal.node(owner.amountNode as NonNullable<typeof owner.amountNode>).amount = "10";
    expect(readBudget(decimal, url, "2026-11")[0]?.amount.minor).toBe(1000);
  });
});

describe("budget persistence against the demo pod", () => {
  it("loads missing months, validates ranges, discovers shards and creates then updates conditionally", async () => {
    const { client, pod } = setup();
    expect(await loadBudgetHistory(client)).toEqual([]);
    expect(await loadBudgetMonths(client, "2026-10", "2026-11")).toEqual([
      { month: "2026-10", assignments: [] },
      { month: "2026-11", assignments: [] },
    ]);
    await expect(loadBudgetMonths(client, "2026-12", "2026-11")).rejects.toThrow();
    await expect(loadBudgetMonths(client, "bad", "2026-11")).rejects.toThrow();
    await provision(client);
    const headers: Headers[] = [];
    const observed = {
      ...client,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT" && String(input).endsWith(".ttl"))
          headers.push(new Headers(init.headers));
        return pod.fetch(input, init);
      },
    };
    await saveBudgetAssignments(observed, "2026-11", [assignment()], []);
    await saveBudgetAssignments(observed, "2026-11", [assignment("90")], [assignment()]);
    await saveBudgetAssignments(observed, "2026-11", [assignment("90")], []); // fulfilled retry
    await saveBudgetAssignments(observed, "2026-10", [assignment("80")], []);
    expect(headers).toHaveLength(3);
    expect(headers[0]?.get("if-none-match")).toBe("*");
    expect(headers[1]?.get("if-match")).toMatch(/^"/);
    expect((await loadBudgetHistory(client)).map((f) => f.month)).toEqual(["2026-10", "2026-11"]);
    const store = storeOf(client);
    await store.put("budgets/notes.txt", "metadata", "text/plain", { create: true });
    expect(await loadBudgetHistory(client)).toHaveLength(2);
    await saveBudgetAssignments(client, "2026-11", [assignment("20", "USD")], []);
    expect((await loadBudgetMonths(client, "2026-11", "2026-11"))[0]?.assignments).toHaveLength(2);
    await expect(
      saveBudgetAssignments(client, "2026-11", [assignment("50")], [assignment("100")]),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      saveBudgetAssignments(client, "2026-11", [assignment("1", "JPY")], [], true),
    ).rejects.toMatchObject({ status: 412 });
  });
  it.each([
    true,
    false,
  ])("reconciles a competing 412 only when the intent is fulfilled (%s)", async (fulfilled) => {
    const { client, pod } = setup();
    await provision(client);
    const racing = {
      ...client,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT" && String(input).endsWith("2026-11.ttl")) {
          await saveBudgetAssignments(
            client,
            "2026-11",
            [assignment(fulfilled ? "100" : "101")],
            [],
          );
          return new Response(null, { status: 412 });
        }
        return pod.fetch(input, init);
      },
    };
    const saved = saveBudgetAssignments(racing, "2026-11", [assignment()], []);
    if (fulfilled) await expect(saved).resolves.toBeUndefined();
    else await expect(saved).rejects.toBeInstanceOf(MoneyIoError);
    expect((await loadBudgetHistory(client))[0]?.assignments[0]?.amount.minor).toBe(
      fulfilled ? 10000 : 10100,
    );
  });
  it("copies only into empty targets and accepts an already completed bulk retry", async () => {
    const { client } = setup();
    await provision(client);
    const rows = [assignment(), assignment("20", "USD")];
    await saveBudgetAssignments(client, "2026-11", rows, [], true);
    await saveBudgetAssignments(client, "2026-11", rows, [], true);
    await expect(
      saveBudgetAssignments(client, "2026-11", [assignment()], [], true),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      saveBudgetAssignments(client, "2026-11", [assignment("200")], rows, true),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("copies over zero assignments, including untouched zero rows, but refuses nonzero concurrent edits", async () => {
    const { client } = setup();
    await provision(client);
    const zeros = [assignment("0"), assignment("0", "USD")];
    await saveBudgetAssignments(client, "2026-11", zeros, []);
    await saveBudgetAssignments(client, "2026-11", [assignment("80")], [], true);
    await saveBudgetAssignments(client, "2026-11", [assignment("80")], [], true);
    expect((await loadBudgetHistory(client))[0]?.assignments).toEqual([
      assignment("80"),
      assignment("0", "USD"),
    ]);
    await expect(
      saveBudgetAssignments(client, "2026-11", [assignment("90")], [], true),
    ).rejects.toMatchObject({ status: 412 });
  });
  it.each([
    "read",
    "container",
    "write",
    "network",
  ])("surfaces %s failures without replacing saved data", async (failure) => {
    const { client, pod } = setup();
    await provision(client);
    const failing = {
      ...client,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input);
        const fail =
          failure === "network" ||
          (failure === "read" && !init?.method) ||
          (failure === "container" && init?.method === "PUT" && target.endsWith("budgets/")) ||
          (failure === "write" && init?.method === "PUT" && target.endsWith(".ttl"));
        if (failure === "network") throw new Error("Offline");
        return fail ? new Response(null, { status: 500 }) : pod.fetch(input, init);
      },
    };
    await expect(saveBudgetAssignments(failing, "2026-11", [assignment()], [])).rejects.toThrow();
    expect(await loadBudgetHistory(client)).toEqual([]);
    if (failure === "read") await expect(loadBudgetHistory(failing)).rejects.toThrow();
  });
  it("ignores external, sibling, nested and malformed listing members", async () => {
    const { client, pod } = setup();
    const doc = new MoneyDocument();
    const { SetFrom, NamedNodeAs, NamedNodeFrom } = await import("@rdfjs/wrapper");
    const members = SetFrom.subjectPredicate(
      doc.node(`${root}money/budgets/`),
      `${NS.LDP}contains`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
    for (const id of [
      "https://evil.example/2026-11.ttl",
      `${root}money/2026-11.ttl`,
      `${root}money/budgets/nested/2026-11.ttl`,
      `${root}money/budgets/2026-13.ttl`,
    ])
      members.add(id);
    const scoped = {
      ...client,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("budgets/"))
          return new Response(await serialiseMoney(doc), {
            headers: { "content-type": "text/turtle" },
          });
        return pod.fetch(input, init);
      },
    };
    expect(await loadBudgetHistory(scoped)).toEqual([]);
  });
});

describe("ledger to envelope calculation", () => {
  const income = `${root}money/categories.ttl#income`;
  const salary = `${root}money/categories.ttl#salary`;
  const categories = [
    { id: category, label: "Food" },
    { id: income, label: " Income " },
    { id: salary, label: "Salary", parent: income },
  ];
  const transaction = (
    id: string,
    value: string,
    month = "2026-11",
    cat?: string,
    currency = "GBP",
  ): Transaction => ({
    id,
    amount: value,
    currency,
    account: `${root}money/accounts/current.ttl#account`,
    description: id,
    postingTime: `${month}-12`,
    ...(cat ? { category: cat } : {}),
  });
  it.each([
    "2026-10",
    "2026-11",
  ])("keeps fully funded monthly assignments from over-assigning %s", (month) => {
    const files = [
      { month: "2026-10", assignments: [assignment("1000")] },
      { month: "2026-11", assignments: [assignment("1000")] },
    ];
    const rows = [
      transaction("oct-pay", "1000", "2026-10"),
      transaction("nov-pay", "1000", "2026-11"),
    ];
    const view = budgetView(files, rows, categories, month, [], "2026-11");
    expect(view.current.month).toBe(month);
    expect(view.current.currencies).toEqual([
      {
        currency: "GBP",
        availableToBudget: 0,
        envelopes: [
          {
            categoryId: category,
            assigned: 100000,
            activity: 0,
            rollover: month === "2026-10" ? 0 : 100000,
            available: month === "2026-10" ? 100000 : 200000,
          },
        ],
      },
    ]);
  });
  it.each([
    "2026-10",
    "2026-11",
  ])("shows December's unfunded shortfall in %s even when January recovers", (month) => {
    const files = [
      { month: "2026-10", assignments: [assignment("1000")] },
      { month: "2026-11", assignments: [assignment("1000")] },
      { month: "2026-12", assignments: [assignment("1500")] },
      { month: "2027-01", assignments: [] },
    ];
    const rows = [
      transaction("oct-pay", "1000", "2026-10"),
      transaction("nov-pay", "1000", "2026-11"),
      transaction("jan-pay", "5000", "2027-01"),
      transaction("future-uncat", "-10", "2026-12", undefined, "KWD"),
      transaction("future-spend", "-50", "2026-12", category),
    ];
    const view = budgetView(files, rows, categories, month, [], "2026-11");
    expect(view.current.currencies).toHaveLength(1);
    expect(view.current.currencies[0]?.availableToBudget).toBe(-150000);
    expect(view.current.currencies[0]?.envelopes).toEqual([
      {
        categoryId: category,
        assigned: 100000,
        activity: 0,
        rollover: month === "2026-10" ? 0 : 100000,
        available: month === "2026-10" ? 100000 : 200000,
      },
    ]);
    expect(view.uncategorised).toBe(0);
  });
  it.each([
    "2026-10",
    "2026-11",
  ])("takes independent future pool minima per currency in %s", (month) => {
    const files = [
      { month: "2026-10", assignments: [assignment("1000"), assignment("100", "USD")] },
      { month: "2026-11", assignments: [assignment("1000"), assignment("250", "USD")] },
      {
        month: "2026-12",
        assignments: [assignment("1500"), assignment("100", "USD"), assignment("20", "JPY")],
      },
    ];
    const rows = [
      transaction("oct-gbp", "1000", "2026-10"),
      transaction("nov-gbp", "1000", "2026-11"),
      transaction("oct-usd", "200", "2026-10", undefined, "USD"),
      transaction("nov-usd", "200", "2026-11", undefined, "USD"),
      transaction("dec-usd", "100", "2026-12", undefined, "USD"),
    ];
    const view = budgetView(files, rows, categories, month, [], "2026-11");
    expect(
      view.current.currencies.map(({ currency, availableToBudget }) => ({
        currency,
        availableToBudget,
      })),
    ).toEqual([
      { currency: "GBP", availableToBudget: -150000 },
      { currency: "JPY", availableToBudget: -20 },
      { currency: "USD", availableToBudget: 5000 },
    ]);
    expect(view.current.currencies[1]?.envelopes).toEqual([]);
  });
  it("counts future income in its own month without increasing this month's pool or hiding over-assignment", () => {
    const files = [
      { month: "2026-11", assignments: [assignment("100")] },
      { month: "2027-02", assignments: [assignment("500"), assignment("20", "USD")] },
    ];
    const rows = [transaction("pay", "500"), transaction("future-pay", "1000", "2026-12")];
    expect(budgetView(files, rows, categories, "2026-11").current.currencies).toEqual([
      {
        currency: "GBP",
        availableToBudget: 40000,
        envelopes: [
          { categoryId: category, assigned: 10000, activity: 0, rollover: 0, available: 10000 },
        ],
      },
      { currency: "USD", availableToBudget: -2000, envelopes: [] },
    ]);
    expect(
      budgetView(files, rows, categories, "2026-12").current.currencies[0]?.availableToBudget,
    ).toBe(90000);
    const released = [
      { month: "2026-11", assignments: [assignment("600")] },
      { month: "2026-12", assignments: [assignment("-200")] },
    ];
    expect(
      budgetView(released, rows, categories, "2026-11").current.currencies[0]?.availableToBudget,
    ).toBe(-10000);
  });
  it.each([
    "budget",
    "transaction",
  ])("includes today and a future-only %s record in navigation bounds", (source) => {
    const files = source === "budget" ? [{ month: "2028-06", assignments: [] }] : [];
    const rows = source === "transaction" ? [transaction("future", "100", "2028-06")] : [];
    expect(budgetMonthBounds(files, rows, "2026-11")).toEqual({
      min: "2025-11",
      max: "2029-06",
    });
    for (const month of ["2025-11", "2026-11", "2029-06"])
      expect(budgetView(files, rows, categories, month, [], "2026-11").current.month).toBe(month);
    for (const month of ["2025-10", "2029-07"])
      expect(() => budgetView(files, rows, categories, month, [], "2026-11")).toThrow(
        "Budget month out of range",
      );
  });
  it("derives both navigation bounds from today and all budget and transaction months", () => {
    expect(
      budgetMonthBounds(
        [
          { month: "2028-06", assignments: [] },
          { month: "2025-04", assignments: [] },
        ],
        [transaction("latest", "100", "2029-09"), transaction("earliest", "100", "2024-02")],
        "2026-11",
      ),
    ).toEqual({ min: "2023-02", max: "2030-09" });
    expect(budgetMonthBounds([], [], "2026-11")).toEqual({ min: "2025-11", max: "2027-11" });
  });
  it("rejects distant selected months before generating ranges and accepts both inclusive limits", () => {
    const files = [{ month: "2026-09", assignments: [assignment("100")] }];
    for (const month of ["9999-12", "0001-01", "2027-12", "2025-08"])
      expect(() => budgetView(files, [], categories, month, [], "2026-11")).toThrow(
        "Budget month out of range",
      );
    for (const month of ["2025-09", "2027-11"])
      expect(budgetView(files, [], categories, month, [], "2026-11").current.month).toBe(month);
    expect(budgetView([], [], [], "0001-01", [], "0001-01").start).toBe("0001-01");
    expect(budgetView([], [], [], "9999-12", [], "9999-12").start).toBe("9999-12");
    expect(budgetMonthBounds([], [])).toEqual(
      budgetMonthBounds([], [], new Date().toISOString().slice(0, 7)),
    );
    expect(budgetMonthBounds([{ month: "0001-10", assignments: [] }], [], "9999-03")).toEqual({
      min: "0001-01",
      max: "9999-12",
    });
  });
  it("keeps deleted-category spending and refunds in its envelope and out of income and warnings", () => {
    const removed = `${root}money/categories.ttl#deleted`;
    const view = budgetView(
      [{ month: "2026-10", assignments: [assignment("100", "GBP", removed)] }],
      [
        transaction("pay", "500"),
        transaction("spend", "-70", "2026-11", removed),
        transaction("refund", "10", "2026-11", removed),
        transaction("uncat", "-5"),
      ],
      categories,
      "2026-11",
    );
    expect(view.uncategorised).toBe(1);
    expect(view.current.currencies[0]).toEqual({
      currency: "GBP",
      availableToBudget: 40000,
      envelopes: [
        { categoryId: removed, assigned: 0, activity: -6000, rollover: 10000, available: 4000 },
      ],
    });
  });
  it("carries income, assignments, refunds and overspending through gaps per currency, excludes both transfer legs", () => {
    expect([...incomeCategoryIds(categories)]).toEqual([income, salary]);
    const rows = [
      transaction("income", "1000", "2026-09", salary),
      transaction("expense", "-70", "2026-09", category),
      transaction("refund", "5.500", "2026-11", category),
      transaction("uncat-income", "40"),
      transaction("uncat-spend", "-2"),
      transaction("unknown", "-8", "2026-11", `${root}unknown`),
      transaction("reverse-income", "-20", "2026-11", salary),
      transaction("usd", "100", "2026-11", undefined, "USD"),
      { ...transaction("debit", "-500", "2026-11", category), debitAccount: "from" },
      { ...transaction("credit", "500"), creditAccount: "to" },
      transaction("future", "9999", "2026-12"),
    ];
    const view = budgetView(
      [
        { month: "2026-09", assignments: [assignment("50")] },
        { month: "2026-11", assignments: [assignment("10"), assignment("20", "USD")] },
      ],
      rows,
      categories,
      "2026-11",
      ["GBP", "USD", "JPY"],
    );
    expect(view.start).toBe("2026-09");
    expect(view.uncategorised).toBe(1);
    expect(view.current.currencies).toEqual([
      {
        currency: "GBP",
        availableToBudget: 96000,
        envelopes: [
          { categoryId: category, assigned: 1000, activity: 550, rollover: -2000, available: -450 },
          {
            categoryId: `${root}unknown`,
            assigned: 0,
            activity: -800,
            rollover: 0,
            available: -800,
          },
        ],
      },
      { currency: "JPY", availableToBudget: 0, envelopes: [] },
      {
        currency: "USD",
        availableToBudget: 8000,
        envelopes: [
          { categoryId: category, assigned: 2000, activity: 0, rollover: 0, available: 2000 },
        ],
      },
    ]);
    expect(budgetView([], [], [], "2026-01").current).toEqual({ month: "2026-01", currencies: [] });
    expect(
      budgetView(
        [{ month: "2026-01", assignments: [assignment("100")] }],
        [],
        categories,
        "2026-03",
      ).start,
    ).toBe("2026-01");
    expect(() =>
      budgetView([], [transaction("bad", "1", "2026-11", undefined, "BTC")], [], "2026-11"),
    ).toThrow();
    expect(() => budgetView([], [transaction("fine", "1.001")], [], "2026-11")).toThrow();
  });
  it("loads the actual ledger, categories and budgets together, excluding paired transfers", async () => {
    const { client } = setup();
    await provision(client);
    await saveCategories(client, () => categories);
    const account = await createAccount(client, "current", {
      name: "Current",
      type: "current",
      currency: "GBP",
      openingBalance: "1000",
      date: "2026-09-01",
    });
    const savings = await createAccount(client, "savings", {
      name: "Savings",
      type: "savings",
      currency: "GBP",
      openingBalance: "100",
      date: "2026-09-01",
    });
    await addTransaction(client, "salary", {
      account: account.id,
      amount: "2000",
      currency: "GBP",
      description: "Salary",
      postingTime: "2026-10-01",
      category: salary,
    });
    await addTransaction(client, "food", {
      account: account.id,
      amount: "-30",
      currency: "GBP",
      description: "Market",
      postingTime: "2026-11-01",
      category,
    });
    const summaries = await listAccounts(client, "2026-11-03");
    await createTransfer(
      client,
      "transfer",
      must(summaries.find((row) => row.id === account.id)),
      must(summaries.find((row) => row.id === savings.id)),
      "2026-11-02",
      "200",
    );
    await saveBudgetAssignments(client, "2026-10", [assignment("100")], []);
    const view = await loadBudget(client, "2026-11");
    expect(view.start).toBe("2026-10");
    expect(view.current.currencies[0]).toMatchObject({
      availableToBudget: 190000,
      envelopes: [{ available: 7000, rollover: 10000, activity: -3000, assigned: 0 }],
    });
  });
});

it("resumes partial demo budgets using the reserved month and never overwrites a completed sample", async () => {
  const { ensureSample } = await import("../src/apps/money/demo/sample");
  const { pod, client } = setup();
  let fail = true;
  const session = {
    ...client,
    mode: "demo" as const,
    webId: `${root}profile#me`,
    displayName: "Example",
    subscribe: pod.subscribe,
    reset: async () => {},
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && init?.method === "PUT" && String(input).endsWith("budgets/2026-11.ttl")) {
        fail = false;
        return new Response(null, { status: 500 });
      }
      return pod.fetch(input, init);
    },
  };
  await expect(ensureSample(session, new Date("2026-11-11T12:00:00Z"))).rejects.toMatchObject({
    status: 500,
  });
  expect((await loadBudgetHistory(session)).map((file) => file.month)).toEqual(["2026-10"]);
  await ensureSample(session, new Date("2026-12-02T12:00:00Z"));
  const files = await loadBudgetHistory(session);
  expect(files.map((file) => file.month)).toEqual(["2026-10", "2026-11"]);
  expect(files.every((file) => file.assignments.length === 2)).toBe(true);
  const groceries = must(
    files[1]?.assignments.find((row) => row.categoryId.endsWith("#groceries")),
  );
  await saveBudgetAssignments(
    session,
    "2026-11",
    [{ ...groceries, amount: amount("GBP", "300") }],
    [groceries],
  );
  await ensureSample(session, new Date("2026-12-03T12:00:00Z"));
  expect(
    (await loadBudgetHistory(session))[1]?.assignments.find(
      (row) => row.categoryId === groceries.categoryId,
    )?.amount.minor,
  ).toBe(30000);
});
