// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Fragment } from "react";
import { expect, it, vi } from "vitest";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/money",
  useSearchParams: () => new URLSearchParams("q=Market"),
}));

import { CategoriesScreen } from "../src/apps/money/components/categories";
import { ImportScreen } from "../src/apps/money/components/import";
import { LedgerScreen } from "../src/apps/money/components/ledger";
import { Amount } from "../src/apps/money/components/money-forms";
import { AccountsScreen } from "../src/apps/money/components/overview";
import { SearchScreen } from "../src/apps/money/components/search";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import { saveCategories } from "../src/apps/money/lib/data/categories";
import { provision, storeOf } from "../src/apps/money/lib/data/container";
import { addTransaction, bulkCategorise, categorised } from "../src/apps/money/lib/data/ledger";
import { MoneyProvider, useMoney } from "../src/apps/money/state/money-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const requireSuite = createRequire(import.meta.url);
const axe = createRequire(requireSuite.resolve("@axe-core/playwright"))("axe-core") as {
  run(node: Element, options: unknown): Promise<{ violations: unknown[] }>;
};
vi.stubGlobal("matchMedia", window.matchMedia.bind(window));
for (const key of [
  "HTMLFormElement",
  "HTMLSelectElement",
  "HTMLOptionElement",
  "DocumentFragment",
  "ShadowRoot",
  "SVGElement",
  "Document",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
] as const)
  vi.stubGlobal(key, window[key]);
HTMLElement.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
let money: ReturnType<typeof useMoney>;
function Probe() {
  money = useMoney();
  return h("p", { "data-testid": "money-status" }, money.status);
}
async function setup(empty = false) {
  const pod = createDemoPod({ root: "https://money-ui.example/", latency: 0 });
  let broken = false;
  const session: PodSession = {
    mode: "demo",
    storageUrl: pod.root,
    webId: pod.root + "me",
    displayName: "Example",
    fetch: async (input, init) =>
      broken ? new Response(null, { status: 500 }) : pod.fetch(input, init),
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await provision(session);
  const base = storeOf(session).resolve("categories.ttl");
  const cats = [
    { id: base + "#food", label: "Food" },
    { id: base + "#market", label: "Groceries", parent: base + "#food" },
    { id: base + "#fun", label: "Fun" },
  ];
  let id = "";
  let rowId = "";
  if (!empty) {
    id = (
      await createAccount(session, "current", {
        name: "Daily spending",
        type: "current",
        currency: "GBP",
        openingBalance: "1000",
        date: "2026-01-01",
      })
    ).id;
    await saveCategories(session, cats);
    rowId = (
      await addTransaction(session, "market", {
        account: id,
        postingTime: new Date().toISOString().slice(0, 10),
        description: "Market",
        amount: "-20",
        currency: "GBP",
      })
    ).id;
  }
  const app = await mount(h(MoneyProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.status).toBe(empty ? "empty" : "ready");
  });
  return {
    app,
    session,
    id,
    rowId,
    cats,
    breakStorage: (value: boolean) => {
      broken = value;
    },
  };
}
async function screen(f: Awaited<ReturnType<typeof setup>>, node: ReturnType<typeof h>) {
  await f.app.render(
    h(MoneyProvider, { session: f.session, children: h(Fragment, null, h(Probe), node) }),
  );
}
it("renders overview, ledger, cards, category tree and search with named controls", async () => {
  const f = await setup();
  await screen(f, h(AccountsScreen, { overviewPage: true }));
  expect(f.app.host.querySelector("h1")?.textContent).toBe("Overview");
  expect(f.app.host.textContent).toContain("£980.00");
  expect(f.app.host.textContent).toContain("Market");
  await screen(f, h(LedgerScreen, { accountId: f.id }));
  expect(f.app.host.querySelector("h1")?.textContent).toContain("Daily spending");
  expect(f.app.host.querySelector(".mon-ledger-card")?.textContent).toContain("Market");
  expect(f.app.host.querySelectorAll('[aria-label="Category for Market"]').length).toBeGreaterThan(
    0,
  );
  await screen(f, h(CategoriesScreen));
  const food = f.app.host.querySelector<HTMLElement>('[role="treeitem"][aria-label^="Food,"]');
  expect(food).not.toBeNull();
  food?.focus();
  await key(food as HTMLElement, "ArrowRight");
  expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Groceries,/);
  await key(document.activeElement as Element, "ArrowLeft");
  expect(document.activeElement).toBe(food);
  await key(food as HTMLElement, "ArrowLeft");
  expect(food?.getAttribute("aria-expanded")).toBe("false");
  await key(food as HTMLElement, "ArrowRight");
  expect(food?.getAttribute("aria-expanded")).toBe("true");
  await screen(f, h(SearchScreen));
  expect(f.app.host.querySelector("h1")?.textContent).toContain("Market");
  expect(f.app.host.querySelector('a[href^="/money/a/"]')?.textContent).toBe("Market");
});
it("keeps newer optimistic edits after an older failure, rolls back failures and refreshes notifications", async () => {
  const f = await setup();
  const gate = deferred<void>();
  const first = () =>
    money.mutate(
      () => gate.promise,
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) => categorised(row, f.cats[0]!.id)),
      }),
    );
  let a!: Promise<boolean>;
  let b!: Promise<boolean>;
  await act(async () => {
    a = first();
    b = money.mutate(
      () => bulkCategorise(f.session, [f.rowId], f.cats[2]!.id),
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) => categorised(row, f.cats[2]!.id)),
      }),
    );
  });
  expect(money.transactions[0]?.category).toBe(f.cats[2]!.id);
  expect(money.saving).toBe(true);
  await act(async () => {
    gate.reject(new Error("First write failed"));
    await Promise.all([a, b]);
  });
  expect(money.transactions[0]?.category).toBe(f.cats[2]!.id);
  expect(money.saving).toBe(false);
  await act(async () => {
    await money.mutate(
      async () => {
        throw { status: 412 };
      },
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) => categorised(row, f.cats[0]!.id)),
      }),
    );
  });
  expect(money.transactions[0]?.category).toBe(f.cats[2]!.id);
  await act(() => bulkCategorise(f.session, [f.rowId], f.cats[1]!.id));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.transactions[0]?.category).toBe(f.cats[1]!.id);
  });
  f.breakStorage(true);
  await act(() => money.refresh());
  expect(money.status).toBe("error");
  expect(money.transactions).toEqual([]);
  f.breakStorage(false);
  await act(() => money.refresh());
  expect(money.status).toBe("ready");
});
it("renders first-use actions and validates a transaction dialog without writing empty records", async () => {
  const empty = await setup(true);
  await screen(empty, h(AccountsScreen, { overviewPage: true }));
  expect(empty.app.host.textContent).toContain("Add an account");
  expect(empty.app.host.textContent).toContain("Import a statement");
  await empty.app.unmount();
  const f = await setup();
  await screen(f, h(LedgerScreen, { accountId: f.id }));
  const add = Array.from(f.app.host.querySelectorAll("button")).find(
    (button) => button.textContent === "Add transaction",
  );
  await click(add as Element);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  await act(async () => {
    dialog
      ?.querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(dialog?.textContent).toContain("Enter a payee or description");
  expect(money.transactions).toHaveLength(1);
  // Run the installed axe engine on the actual form and tree semantics. jsdom
  // has no layout, so browser colour contrast remains in the Playwright matrix.
  const result = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations).toEqual([]);
});

it("imports the 100-row fixture through mapping and preview, updating balances and provenance", async () => {
  const f = await setup();
  await screen(f, h(ImportScreen));
  const text = await readFile(
    new URL("../e2e/money/fixtures/statement.csv", import.meta.url),
    "utf8",
  );
  const input = f.app.host.querySelector<HTMLInputElement>('[aria-label="Statement file"]');
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([text], "statement.csv", { type: "text/csv" })],
  });
  await act(async () => {
    input?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("CSV ready");
  });
  const button = (label: string) =>
    Array.from(f.app.host.querySelectorAll("button")).find(
      (node) => node.textContent === label,
    ) as HTMLButtonElement;
  await click(button("Continue"));
  expect(f.app.host.querySelector("h2")?.textContent).toBe("Map columns");
  await click(button("Preview transactions"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("100 of 100 transactions selected");
  });
  expect(f.app.host.querySelectorAll(".mon-preview-list tbody tr")).toHaveLength(100);
  await click(button("Import 100 transactions"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("100 transactions added to Daily spending");
  });
  expect(money.transactions.filter((row) => row.derivedFrom)).toHaveLength(100);
  expect(money.accounts[0]?.currentBalance).toBe("-2520");
  await screen(f, h(LedgerScreen, { accountId: f.id }));
  const dateFilter = Array.from(f.app.host.querySelectorAll("button")).find(
    (button) => button.textContent === "Last 90 days",
  );
  await click(dateFilter as Element);
  const choose = async (label: string, value: string) => {
    const trigger = f.app.host.querySelector(`[role="combobox"][aria-label="${label}"]`);
    await key(trigger as Element, "Enter");
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      (node) => node.textContent === value,
    );
    expect(option).toBeDefined();
    await click(option as Element);
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(money.saving).toBe(false);
    });
  };
  for (const name of ["Merchant 100", "Merchant 099", "Merchant 098"])
    await choose(`Category for ${name}`, "Groceries");
  expect(money.transactions.filter((row) => row.category === f.cats[1]!.id)).toHaveLength(3);
  for (const name of ["Merchant 100", "Merchant 099", "Merchant 098"])
    await click(f.app.host.querySelector(`input[aria-label="Select ${name}"]`) as Element);
  expect(
    f.app.host.querySelector('[role="toolbar"][aria-label="Selection actions"]')?.textContent,
  ).toContain("3 selected");
  await choose("Categorise selected as", "Fun");
  expect(money.transactions.filter((row) => row.category === f.cats[2]!.id)).toHaveLength(3);
}, 120_000);

it("displays large balances and negative fractions without floating-point rounding", async () => {
  const app = await mount(
    h(
      Fragment,
      null,
      h(Amount, { amount: "90071992547409.93", currency: "GBP" }),
      h(Amount, { amount: "-0.01", currency: "GBP" }),
      h(Amount, { amount: "12", currency: "JPY" }),
    ),
  );
  expect(app.host.textContent).toBe("£90,071,992,547,409.93-£0.01JP¥12");
});
