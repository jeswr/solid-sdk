// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, click, deferred, h, mount } from "./drive-ui-dom";
import { must } from "./money/helpers";

const navigation = vi.hoisted(() => ({ path: "/money", query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => navigation.path,
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

import { BudgetScreen } from "../src/apps/money/components/budget";
import { CategoriesScreen } from "../src/apps/money/components/categories";
import { ImportScreen } from "../src/apps/money/components/import";
import { LedgerScreen } from "../src/apps/money/components/ledger";
import { MoneyContent } from "../src/apps/money/components/money-states";
import { AccountsScreen } from "../src/apps/money/components/overview";
import { RecurringScreen } from "../src/apps/money/components/recurring";
import { ReportsScreen } from "../src/apps/money/components/reports";
import { RulesScreen } from "../src/apps/money/components/rules";
import { SearchScreen } from "../src/apps/money/components/search";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import { saveBudgetAssignments } from "../src/apps/money/lib/data/budget";
import { provision, storeOf } from "../src/apps/money/lib/data/container";
import { addTransaction } from "../src/apps/money/lib/data/ledger";
import { MoneyDocument, putBalance } from "../src/apps/money/lib/model";
import { MoneyProvider, useMoney } from "../src/apps/money/state/money-context";
import { readMoneySnapshot } from "../src/apps/money/state/read-snapshot";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { AccountsContext } from "../src/shell/session/accounts-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";

beforeEach(() => {
  navigation.path = "/money";
  navigation.query = "";
  for (const key of [
    "HTMLFormElement",
    "HTMLSelectElement",
    "DocumentFragment",
    "ShadowRoot",
    "SVGElement",
    "Document",
    "HTMLButtonElement",
  ] as const)
    vi.stubGlobal(key, window[key]);
  vi.stubGlobal("matchMedia", window.matchMedia.bind(window));
});

const today = "2026-11-01";
function fixture() {
  const pod = createDemoPod({ root: "https://money-states.example/", latency: 0 });
  let transport = pod.fetch;
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => transport(input, init));
  // A real session has no demo seeding; this exercises genuinely absent app containers.
  const session: PodSession = {
    mode: "solid",
    fetch,
    publicFetch: pod.fetch,
    storageUrl: pod.root,
    webId: `${pod.root}me`,
    displayName: "Example",
    subscribe: () => () => {},
  };
  return {
    pod,
    session,
    fetch,
    intercept: (next: typeof fetch) => {
      transport = next;
    },
  };
}
let money: ReturnType<typeof useMoney>;
function Probe() {
  money = useMoney();
  return null;
}
async function render(
  session: PodSession,
  children: ReactNode = h(AccountsScreen, { overviewPage: true }),
) {
  return mount(
    h(MoneyProvider, {
      session,
      children: h("main", { className: "mon-page" }, h(Probe), h(MoneyContent, { children })),
    }),
  );
}
async function settled() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.status).not.toBe("loading");
  });
}
function button(host: HTMLElement, label: string) {
  const node = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
}

const empties = [
  ["/money", h(AccountsScreen, { overviewPage: true }), "No accounts yet", "Add an account"],
  ["/money/accounts", h(AccountsScreen), "No accounts yet", "Add an account"],
  [
    "/money/budget",
    h(BudgetScreen),
    "Assign money to categories to start budgeting",
    "Add categories",
  ],
  ["/money/categories", h(CategoriesScreen), "No categories yet", "Add category"],
  ["/money/import", h(ImportScreen), "No account to import into yet", "Create an account"],
  ["/money/recurring", h(RecurringScreen), "No recurring payments yet", "Import a statement"],
  ["/money/reports", h(ReportsScreen), "Nothing to report yet", "Import a statement"],
  ["/money/rules", h(RulesScreen), "Add a category first", "Go to categories"],
  ["/money/search", h(SearchScreen), "No transactions to search yet", "Import a statement"],
] as const;

it.each(
  empties,
)("%s has one first-use action for absent and empty containers", async (path, screen, heading, action) => {
  for (const present of [false, true]) {
    const f = fixture();
    if (present) await provision(f.session);
    navigation.path = path;
    const app = await render(f.session, screen);
    await settled();
    expect(app.host.querySelectorAll("h1")).toHaveLength(1);
    const state = Array.from(app.host.querySelectorAll(".suite-async-state")).find(
      (node) => node.querySelector("h3")?.textContent === heading,
    );
    expect(state).toBeDefined();
    expect(
      state?.querySelectorAll(".suite-async-actions a, .suite-async-actions button"),
    ).toHaveLength(1);
    const primary = state?.querySelector<HTMLElement>("a, button");
    expect(primary?.textContent).toBe(action);
    primary?.focus();
    expect(document.activeElement).toBe(primary);
    await app.unmount();
  }
});

it("names loading and does not flash first-use content during a delayed read", async () => {
  const f = fixture();
  const release = deferred<void>();
  f.intercept(
    vi.fn(async (input, init) => {
      await release.promise;
      return f.pod.fetch(input, init);
    }),
  );
  const app = await render(f.session);
  expect(app.host.querySelector('[role="status"][aria-label="Loading Money"]')).not.toBeNull();
  expect(app.host.textContent).not.toContain("No accounts yet");
  await act(async () => release.resolve());
  await settled();
  expect(app.host.textContent).toContain("No accounts yet");
});

it.each([
  401,
  403,
  500,
  "network",
  "turtle",
] as const)("re-reads a failed main index (%s) on Retry and restores heading focus", async (failure) => {
  const f = fixture();
  f.intercept(
    vi.fn(async (input, init) => {
      if (String(input).endsWith("money/")) {
        if (failure === "network") throw new TypeError("private network details");
        if (failure === "turtle")
          return new Response("not turtle {{{", { headers: { "content-type": "text/turtle" } });
        return new Response(null, { status: failure });
      }
      return f.pod.fetch(input, init);
    }),
  );
  const app = await render(f.session);
  await settled();
  expect(app.host.querySelector("h1")?.textContent).toBe("Couldn't open Money");
  expect(app.host.textContent).not.toContain("private network details");
  if (failure === 401 || failure === 403) expect(app.host.textContent).toContain("account menu");
  const reads = f.fetch.mock.calls.length;
  f.intercept(vi.fn(f.pod.fetch));
  await click(button(app.host, "Retry"));
  await vi.waitFor(() => expect(app.host.textContent).toContain("No accounts yet"));
  expect(f.fetch.mock.calls.length).toBeGreaterThan(reads);
  expect(document.activeElement).toBe(app.host.querySelector("h1"));
});

async function seed(f: ReturnType<typeof fixture>) {
  const account = await createAccount(f.session, "current", {
    name: "Current account",
    type: "current",
    currency: "GBP",
    openingBalance: "100",
    date: "2026-08-01",
  });
  for (const month of ["09", "10"])
    await addTransaction(f.session, `purchase-${month}`, {
      account: account.id,
      postingTime: `2026-${month}-01`,
      amount: "-5",
      currency: "GBP",
      description: `Purchase ${month}`,
    });
  return account;
}

it("keeps healthy items and last readable copies, dismisses partial problems, and retries repaired documents", async () => {
  const f = fixture();
  await seed(f);
  const app = await render(f.session, h(SearchScreen));
  await settled();
  const before = money.transactions;
  let broken = true;
  f.intercept(
    vi.fn(async (input, init) =>
      broken && String(input).endsWith("transactions/2026-09.ttl")
        ? new Response("bad {{{", { headers: { "content-type": "text/turtle" } })
        : f.pod.fetch(input, init),
    ),
  );
  const coldRead = await readMoneySnapshot(f.session, today);
  expect(coldRead.transactions.map((row) => row.description)).toEqual(["Purchase 10"]);
  expect(coldRead.problems).toHaveLength(1);
  await act(() => money.refresh());
  expect(money.transactions).toEqual(expect.arrayContaining(before));
  expect(app.host.textContent).toContain("1 item couldn't be read");
  expect(app.host.textContent).toContain("Purchase 10");
  await click(must(app.host.querySelector('[aria-label="Dismiss read problems"]')));
  expect(app.host.querySelector('[aria-label="Money read problems"]')).toBeNull();
  await act(() => money.refresh());
  broken = false;
  await click(button(app.host, "Retry"));
  expect(money.problems).toEqual([]);
  expect(app.host.querySelector('[aria-label="Money read problems"]')).toBeNull();
});

it("a listed document's 404 is a read problem, while an absent app is empty", async () => {
  const f = fixture();
  await seed(f);
  f.intercept(
    vi.fn(async (input, init) =>
      String(input).endsWith("accounts/current.ttl")
        ? new Response(null, { status: 404 })
        : f.pod.fetch(input, init),
    ),
  );
  const snapshot = await readMoneySnapshot(f.session, today);
  expect(snapshot.problems).toEqual([
    expect.objectContaining({ kind: "accounts", error: expect.objectContaining({ status: 404 }) }),
  ]);
  const app = await render(f.session);
  await settled();
  expect(app.host.textContent).toContain("Couldn't open Money");
  expect(app.host.textContent).not.toContain("No accounts yet");
});

it.each([
  "accounts/",
  "transactions/",
])("a required %s index's 404 is a whole-view failure", async (path) => {
  const f = fixture();
  await seed(f);
  f.intercept(
    vi.fn(async (input, init) =>
      String(input).endsWith(`money/${path}`)
        ? new Response(null, { status: 404 })
        : f.pod.fetch(input, init),
    ),
  );
  const app = await render(f.session);
  await settled();
  expect(money.status).toBe("error");
  expect(app.host.querySelector("h1")?.textContent).toBe("Couldn't open Money");
  expect(app.host.textContent).not.toContain("No accounts yet");
});

it("retains the visible snapshot if the main container fails on refresh", async () => {
  const f = fixture();
  await seed(f);
  const app = await render(f.session);
  await settled();
  f.intercept(vi.fn(async () => new Response(null, { status: 500 })));
  await act(() => money.refresh());
  expect(app.host.textContent).toContain("Money couldn't be refreshed");
  expect(app.host.textContent).toContain("Current account");
});

it("uses the latest balance across readable account documents", async () => {
  const f = fixture();
  const account = await seed(f);
  const store = storeOf(f.session);
  const document = new MoneyDocument();
  putBalance(document, {
    id: `${store.resolve("accounts/snapshot.ttl")}#balance`,
    account: account.id,
    amount: "120",
    currency: "GBP",
    asOf: "2026-10-31",
  });
  await store.write("accounts/snapshot.ttl", document, { create: true });
  const snapshot = await readMoneySnapshot(f.session, today);
  expect(snapshot.accounts[0]?.currentBalance).toBe("120");
  expect(snapshot.problems).toEqual([]);
});

it("retains readable budget history if its listing becomes unavailable", async () => {
  const f = fixture();
  await seed(f);
  await saveBudgetAssignments(
    f.session,
    "2026-10",
    [
      {
        categoryId: `${storeOf(f.session).resolve("categories.ttl")}#food`,
        amount: { currency: "GBP", minor: 100 },
      },
    ],
    [],
  );
  const app = await render(f.session, h(BudgetScreen));
  await settled();
  const before = money.budgets;
  expect(before).toHaveLength(1);
  f.intercept(
    vi.fn(async (input, init) =>
      String(input).endsWith("budgets/")
        ? new Response(null, { status: 500 })
        : f.pod.fetch(input, init),
    ),
  );
  await act(() => money.refresh());
  expect(money.budgets).toEqual(before);
  expect(app.host.textContent).toContain("1 item couldn't be read");
});

it("offers the shell's Sign in action for a denied read and re-reads after sign-in", async () => {
  const f = fixture();
  let denied = true;
  f.intercept(
    vi.fn(async (input, init) =>
      denied ? new Response(null, { status: 401 }) : f.pod.fetch(input, init),
    ),
  );
  const reauth = vi.fn(async () => {
    denied = false;
    return { id: "test" };
  });
  const app = await mount(
    h(AccountsContext, {
      value: { reauth } as unknown as AccountsContextValue,
      children: h(MoneyProvider, {
        session: f.session,
        children: h(
          "main",
          { className: "mon-page" },
          h(Probe),
          h(MoneyContent, { children: h(AccountsScreen) }),
        ),
      }),
    }),
  );
  await settled();
  await click(button(app.host, "Sign in"));
  expect(reauth).toHaveBeenCalledOnce();
  expect(app.host.textContent).toContain("No accounts yet");
});

it("a listed singleton's 404 is an error rather than first use", async () => {
  const f = fixture();
  await seed(f);
  await storeOf(f.session).put("rules.json", JSON.stringify({ rules: [] }), "application/json", {
    create: true,
  });
  f.intercept(
    vi.fn(async (input, init) =>
      String(input).endsWith("rules.json")
        ? new Response(null, { status: 404 })
        : f.pod.fetch(input, init),
    ),
  );
  const snapshot = await readMoneySnapshot(f.session, today);
  expect(snapshot.rulesProblem).toBe("unavailable");
  expect(snapshot.problems).toEqual([
    expect.objectContaining({ kind: "rules", error: expect.objectContaining({ status: 404 }) }),
  ]);
});

it("keeps the existing reset flow reachable when the rules file is corrupt", async () => {
  const f = fixture();
  await provision(f.session);
  await storeOf(f.session).put("rules.json", "broken JSON", "application/json", { create: true });
  navigation.path = "/money/rules";
  const app = await render(f.session, h(RulesScreen));
  await settled();
  expect(app.host.textContent).toContain("Couldn't read your rules");
  expect(button(app.host, "Retry")).toBeDefined();
  await click(button(app.host, "Start again with no rules"));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("distinguishes a searched empty from first use and an empty ledger from a filtered ledger", async () => {
  const f = fixture();
  navigation.query = "q=missing";
  const app = await render(f.session, h(SearchScreen));
  await settled();
  expect(app.host.textContent).toContain("No results for 'missing'");
  await app.unmount();
  const account = await createAccount(f.session, "cash", {
    name: "Cash",
    type: "cash",
    currency: "GBP",
    openingBalance: "0",
    date: today,
  });
  const ledger = await render(f.session, h(LedgerScreen, { accountId: account.id }));
  await settled();
  expect(ledger.host.textContent).toContain("No transactions yet");
  await addTransaction(f.session, "old", {
    account: account.id,
    postingTime: "2020-01-01",
    amount: "1",
    currency: "GBP",
    description: "Old",
  });
  await act(() => money.refresh());
  expect(ledger.host.textContent).toContain("No transactions match this view");
  await ledger.unmount();
  navigation.query = "";
  const search = await render(f.session, h(SearchScreen));
  await settled();
  expect(search.host.textContent).toContain("No transactions in the last 24 months");
  expect(search.host.textContent).toContain("Import a statement");
});

it.each([
  "categories",
  "rules",
] as const)("%s failures have a route error and Retry, not a first-run empty", async (kind) => {
  const f = fixture();
  await provision(f.session);
  navigation.path = `/money/${kind}`;
  f.intercept(
    vi.fn(async (input, init) =>
      String(input).endsWith(kind === "rules" ? "rules.json" : "categories.ttl")
        ? new Response(null, { status: 403 })
        : f.pod.fetch(input, init),
    ),
  );
  const app = await render(f.session, kind === "rules" ? h(RulesScreen) : h(CategoriesScreen));
  await settled();
  expect(app.host.querySelector("h1")?.textContent).toBe(`Couldn't open your ${kind}`);
  f.intercept(vi.fn(f.pod.fetch));
  await click(button(app.host, "Retry"));
  expect(app.host.querySelector("h1")?.textContent).toBe(kind === "rules" ? "Rules" : "Categories");
});
