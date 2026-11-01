// AUTHORED-BY Codex GPT-6

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Fragment } from "react";
import { expect, it, vi } from "vitest";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";
import { must } from "./money/helpers";

vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/money",
  useSearchParams: () => new URLSearchParams("q=Market"),
}));

import { CategoriesScreen } from "../src/apps/money/components/categories";
import { ImportScreen } from "../src/apps/money/components/import";
import { LedgerScreen } from "../src/apps/money/components/ledger";
import {
  AccountDialog,
  Amount,
  TransactionDialog,
  TransferDialog,
} from "../src/apps/money/components/money-forms";
import { AccountsScreen } from "../src/apps/money/components/overview";
import { SearchScreen } from "../src/apps/money/components/search";
import { createAccount } from "../src/apps/money/lib/data/accounts";
import { saveCategories } from "../src/apps/money/lib/data/categories";
import { provision, storeOf } from "../src/apps/money/lib/data/container";
import { commitImport, previewImport, suggestMapping } from "../src/apps/money/lib/data/import";
import {
  addTransaction,
  allTransactions,
  bulkCategorise,
  categorised,
} from "../src/apps/money/lib/data/ledger";
import { putBalance } from "../src/apps/money/lib/model";
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
  let transport = pod.fetch;
  const session: PodSession = {
    mode: "demo",
    storageUrl: pod.root,
    webId: `${pod.root}me`,
    displayName: "Example",
    fetch: async (input, init) =>
      broken ? new Response(null, { status: 500 }) : transport(input, init),
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await provision(session);
  const base = storeOf(session).resolve("categories.ttl");
  const cats = [
    { id: `${base}#food`, label: "Food" },
    { id: `${base}#market`, label: "Groceries", parent: `${base}#food` },
    { id: `${base}#fun`, label: "Fun" },
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
    await saveCategories(session, () => cats);
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
    pod,
    intercept: (fetch: typeof globalThis.fetch) => {
      transport = fetch;
    },
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
  expect(f.app.host.querySelector("h1")?.textContent).toBe("Daily spending");
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
  for (const shortcut of ["Enter", "F2"]) {
    food?.focus();
    await key(food as HTMLElement, shortcut);
    const input = document.activeElement as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input.value).toBe("Food");
    await key(input, "Escape");
  }
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
        transactions: snapshot.transactions.map((row) => categorised(row, must(f.cats[0]).id)),
      }),
    );
  let a!: Promise<boolean>;
  let b!: Promise<boolean>;
  await act(async () => {
    a = first();
    b = money.mutate(
      () => bulkCategorise(f.session, [f.rowId], must(f.cats[2]).id),
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) => categorised(row, must(f.cats[2]).id)),
      }),
    );
  });
  expect(money.transactions[0]?.category).toBe(must(f.cats[2]).id);
  expect(money.saving).toBe(true);
  await act(async () => {
    gate.reject(new Error("First write failed"));
    await Promise.all([a, b]);
  });
  expect(money.transactions[0]?.category).toBe(must(f.cats[2]).id);
  expect(money.saving).toBe(false);
  await act(async () => {
    await money.mutate(
      async () => {
        throw { status: 412 };
      },
      (snapshot) => ({
        ...snapshot,
        transactions: snapshot.transactions.map((row) => categorised(row, must(f.cats[0]).id)),
      }),
    );
  });
  expect(money.transactions[0]?.category).toBe(must(f.cats[2]).id);
  await act(() => bulkCategorise(f.session, [f.rowId], must(f.cats[1]).id));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.transactions[0]?.category).toBe(must(f.cats[1]).id);
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
  expect(money.transactions.filter((row) => row.category === must(f.cats[1]).id)).toHaveLength(3);
  for (const name of ["Merchant 100", "Merchant 099", "Merchant 098"])
    await click(f.app.host.querySelector(`input[aria-label="Select ${name}"]`) as Element);
  expect(
    f.app.host.querySelector('[role="toolbar"][aria-label="Selection actions"]')?.textContent,
  ).toContain("3 selected");
  await choose("Categorise selected as", "Fun");
  expect(money.transactions.filter((row) => row.category === must(f.cats[2]).id)).toHaveLength(3);
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

it("reconciles notifications received during a mutation reload after its debounce expires", async () => {
  const f = await setup();
  const entered = deferred<void>();
  const release = deferred<void>();
  let intercept = true;
  f.intercept(async (input, init) => {
    const response = await f.pod.fetch(input, init);
    if (intercept && !init?.method && String(input).endsWith("categories.ttl")) {
      intercept = false;
      entered.resolve();
      await release.promise;
    }
    return response;
  });
  let task!: Promise<boolean>;
  await act(async () => {
    task = money.mutate(async () => {});
    await entered.promise;
  });
  const added = { id: `${must(f.cats[0]).id}-new`, label: "External category" };
  await act(async () => {
    await saveCategories({ ...f.session, fetch: f.pod.fetch }, (current) => [...current, added]);
    // Let the notification debounce fire while the captured stale response is still pending.
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
  expect(money.categories).not.toContainEqual(added);
  await act(async () => {
    release.resolve();
    await task;
  });
  expect(money.categories).toContainEqual(added);
  expect(money.saving).toBe(false);
});
it("generation-fences mutation reloads when another write is queued and defers manual refresh while saving", async () => {
  const f = await setup();
  const entered = deferred<void>();
  const release = deferred<void>();
  let intercept = true;
  f.intercept(async (input, init) => {
    const response = await f.pod.fetch(input, init);
    if (intercept && !init?.method && String(input).endsWith("categories.ttl")) {
      intercept = false;
      entered.resolve();
      await release.promise;
    }
    return response;
  });
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  const added = { id: `${must(f.cats[0]).id}-queued`, label: "Queued category" };
  await act(async () => {
    first = money.mutate(async () => {});
    await entered.promise;
  });
  await act(async () => {
    second = money.mutate(
      () => saveCategories(f.session, (current) => [...current, added]),
      (snapshot) => ({ ...snapshot, categories: [...snapshot.categories, added] }),
    );
    await money.refresh();
  });
  expect(money.categories).toContainEqual(added);
  await act(async () => {
    release.resolve();
    await Promise.all([first, second]);
  });
  expect(money.categories.filter((c) => c.id === added.id)).toEqual([added]);
  expect(money.status).toBe("ready");
});

it("offers resume after reopening an import whose rows saved but completion marker failed", async () => {
  const f = await setup();
  const text = `Date,Payee,Amount\n${money.today},Recovery purchase,-3`;
  const options = suggestMapping(text).options;
  const preview = await previewImport(f.session, f.id, "GBP", text, "csv", options);
  await expect(
    commitImport(
      {
        ...f.session,
        fetch: async (input, init) => {
          if (
            init?.method === "PUT" &&
            String(input).endsWith(".json") &&
            String(init.body).includes('"completed"')
          )
            return new Response(null, { status: 500 });
          return f.pod.fetch(input, init);
        },
      },
      f.id,
      "GBP",
      text,
      "csv",
      options,
      preview,
      () => {},
    ),
  ).rejects.toMatchObject({ status: 500 });
  await act(() => money.refresh());
  await screen(f, h(ImportScreen));
  const input = must(f.app.host.querySelector<HTMLInputElement>('[aria-label="Statement file"]'));
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([text], "retry.csv", { type: "text/csv" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = (label: string) =>
    must(
      Array.from(f.app.host.querySelectorAll("button")).find((node) => node.textContent === label),
    );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("CSV ready");
  });
  await click(button("Continue"));
  await click(button("Preview transactions"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("0 of 1 transactions selected");
  });
  expect(button("Resume import").disabled).toBe(false);
  expect(f.app.host.textContent).toContain("original mapping and row selection");
  await click(button("Resume import"));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.textContent).toContain("1 transactions added to Daily spending");
  });
  expect(money.transactions.filter((row) => row.description === "Recovery purchase")).toHaveLength(
    1,
  );
});

it("renames the account heading and saves a category name entirely from the keyboard", async () => {
  const f = await setup();
  await screen(f, h(LedgerScreen, { accountId: f.id }));
  await click(must(f.app.host.querySelector('[aria-label="Rename account"]')));
  const input = must(document.querySelector<HTMLInputElement>("#mon-account-name"));
  await act(async () => {
    must(must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")).set).call(
      input,
      "Everyday account",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    must(input.closest("form")).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(f.app.host.querySelector("h1")?.textContent).toBe("Everyday account");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  await screen(f, h(CategoriesScreen));
  const food = must(
    f.app.host.querySelector<HTMLElement>('[role="treeitem"][aria-label^="Food,"]'),
  );
  food.focus();
  await key(food, "Enter");
  const rename = document.activeElement as HTMLInputElement;
  await act(async () => {
    must(must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")).set).call(
      rename,
      "Meals",
    );
    rename.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(rename, "Enter");
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.saving).toBe(false);
  });
  await act(() => money.refresh());
  expect(money.categories.find((c) => c.id === must(f.cats[0]).id)?.label).toBe("Meals");
});

function button(label: string, root: ParentNode = document) {
  return must(
    Array.from(root.querySelectorAll("button")).find((node) => node.textContent === label),
  );
}
async function fill(label: string, value: string) {
  const labelNode = must(
    Array.from(document.querySelectorAll("label")).find(
      (node) => node.textContent?.trim() === label,
    ),
  );
  const input = must(document.getElementById(labelNode.htmlFor)) as HTMLInputElement;
  await act(async () => {
    must(must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")).set).call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  const form = must(document.querySelector('[role="dialog"] form'));
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(money.saving).toBe(false);
    expect(
      document.querySelector('[role="dialog"] button[type="submit"]')?.hasAttribute("disabled"),
    ).toBe(false);
  });
}
async function select(label: string, value: string) {
  await key(must(document.querySelector(`[role="combobox"][aria-label="${label}"]`)), "Enter");
  await click(
    must(
      Array.from(document.querySelectorAll('[role="option"]')).find(
        (node) => node.textContent === value,
      ),
    ),
  );
}
async function pickFile(host: HTMLElement, file: File) {
  const input = must(host.querySelector<HTMLInputElement>('[aria-label="Statement file"]'));
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function waitForText(host: HTMLElement, text: string) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain(text);
  });
}

it.each([
  "account",
  "transaction",
  "transfer",
] as const)("reuses the %s draft operation after a lost successful response", async (kind) => {
  const f = await setup();
  await createAccount(f.session, "savings", {
    name: "Savings",
    type: "savings",
    currency: "GBP",
    openingBalance: "0",
    date: money.today,
  });
  await act(() => money.refresh());
  const account = must(money.accounts.find((a) => a.id === f.id));
  const close = vi.fn();
  await screen(
    f,
    kind === "account"
      ? h(AccountDialog, { open: true, onOpenChange: close })
      : kind === "transaction"
        ? h(TransactionDialog, { account, open: true, onOpenChange: close })
        : h(TransferDialog, { account, open: true, onOpenChange: close }),
  );
  if (kind === "account") await fill("Account name", "Retry account");
  else {
    if (kind === "transaction") await fill("Payee / description", "Retry purchase");
    else await select("To account", "Savings");
    await fill("Amount (GBP)", "10");
  }
  let once = true;
  const writes: string[] = [];
  f.intercept(async (url, init) => {
    const response = await f.pod.fetch(url, init);
    if (init?.method === "PUT" && String(url).endsWith(".ttl") && response.ok) {
      writes.push(String(url));
      if (once) {
        once = false;
        throw new Error("Lost successful response");
      }
    }
    return response;
  });
  await submit();
  expect(close).not.toHaveBeenCalled();
  await submit();
  expect(close).toHaveBeenCalledWith(false);
  expect(writes).toHaveLength(1);
  expect(money.accounts.filter((a) => a.label === "Retry account")).toHaveLength(
    kind === "account" ? 1 : 0,
  );
  const rows = await allTransactions(f.session);
  expect(rows.filter((r) => r.description === "Retry purchase")).toHaveLength(
    kind === "transaction" ? 1 : 0,
  );
  expect(rows.filter((r) => r.debitAccount)).toHaveLength(kind === "transfer" ? 2 : 0);
});

it("preserves the posting instant on description edits and uses the selected date when changed", async () => {
  const f = await setup();
  const store = storeOf(f.session);
  const loaded = await store.read("accounts/current.ttl");
  putBalance(loaded.document, {
    id: `${loaded.url}#midday`,
    account: f.id,
    amount: "900",
    currency: "GBP",
    asOf: `${money.today}T12:00:00Z`,
  });
  await store.write(loaded.url, loaded.document, loaded.condition);
  const row = await addTransaction(f.session, "afternoon", {
    account: f.id,
    description: "Afternoon purchase",
    amount: "-10",
    currency: "GBP",
    postingTime: `${money.today}T13:45:06.123Z`,
  });
  await act(() => money.refresh());
  const close = vi.fn();
  await screen(
    f,
    h(TransactionDialog, {
      account: must(money.accounts[0]),
      open: true,
      onOpenChange: close,
      transaction: row,
    }),
  );
  await fill("Payee / description", "Edited purchase");
  await submit();
  expect(close).toHaveBeenCalledWith(false);
  expect(money.transactions.find((r) => r.id === row.id)?.postingTime).toBe(row.postingTime);
  expect(money.accounts[0]?.currentBalance).toBe("890");
  await screen(
    f,
    h(TransactionDialog, {
      account: must(money.accounts[0]),
      open: true,
      onOpenChange: close,
      transaction: must(money.transactions.find((r) => r.id === row.id)),
    }),
  );
  await fill("Date", "2026-01-02");
  await submit();
  expect(money.transactions.find((r) => r.description === "Edited purchase")?.postingTime).toBe(
    "2026-01-02",
  );
});

it.each([
  "success",
  "error",
])("ignores a stale file read %s after a newer statement reaches Preview", async (outcome) => {
  const f = await setup();
  await screen(f, h(ImportScreen));
  const old = deferred<string>();
  const oldFile = new File(["old"], "old.csv");
  Object.defineProperty(oldFile, "text", { value: () => old.promise });
  await pickFile(f.app.host, oldFile);
  const text = `Date,Payee,Amount\n${money.today},Reviewed purchase,-7`;
  await pickFile(f.app.host, new File([text], "reviewed.csv"));
  await waitForText(f.app.host, "reviewed.csv · CSV ready");
  await click(button("Continue", f.app.host));
  await click(button("Preview transactions", f.app.host));
  await waitForText(f.app.host, "1 of 1 transactions selected");
  await act(async () => {
    if (outcome === "success")
      old.resolve(`Date,Payee,Amount\n${money.today},Unreviewed purchase,-99`);
    else old.reject(new Error("Old read failed"));
  });
  expect(f.app.host.textContent).not.toContain("Unreviewed purchase");
  expect(f.app.host.textContent).not.toContain("Old read failed");
  await click(button("Import 1 transactions", f.app.host));
  await waitForText(f.app.host, "1 transactions added to Daily spending");
  expect(money.transactions.filter((r) => r.derivedFrom).map((r) => r.description)).toEqual([
    "Reviewed purchase",
  ]);
});

it.each([
  "mapping",
  "account",
] as const)("invalidates an in-flight preview when the %s changes", async (change) => {
  const f = await setup();
  await createAccount(f.session, "savings", {
    name: "Savings",
    type: "savings",
    currency: "GBP",
    openingBalance: "0",
    date: money.today,
  });
  await act(() => money.refresh());
  await screen(f, h(ImportScreen));
  await pickFile(
    f.app.host,
    new File([`Date,Payee,Amount,Alternative\n${money.today},Purchase,-1,-2`], "mapping.csv"),
  );
  await waitForText(f.app.host, "CSV ready");
  await click(button("Continue", f.app.host));
  const entered = deferred<void>();
  const release = deferred<void>();
  let once = true;
  f.intercept(async (url, init) => {
    const response = await f.pod.fetch(url, init);
    if (once && !init?.method && String(url).endsWith("transactions/")) {
      once = false;
      entered.resolve();
      await release.promise;
    }
    return response;
  });
  await click(button("Preview transactions", f.app.host));
  await entered.promise;
  if (change === "mapping") await select("Amount column", "Alternative");
  else {
    await click(button("Back", f.app.host));
    await select("Import into account", "Savings · GBP");
    await click(button("Continue", f.app.host));
  }
  await click(button("Preview transactions", f.app.host));
  await waitForText(f.app.host, "1 of 1 transactions selected");
  await act(async () => {
    release.resolve();
  });
  expect(f.app.host.querySelector(".mon-preview-list")?.textContent).toContain(
    change === "mapping" ? "-£2.00" : "-£1.00",
  );
  await click(button("Import 1 transactions", f.app.host));
  await waitForText(
    f.app.host,
    `1 transactions added to ${change === "account" ? "Savings" : "Daily spending"}`,
  );
  const saved = must(money.transactions.find((r) => r.derivedFrom));
  expect(saved.amount).toBe(change === "mapping" ? "-2" : "-1");
  expect(saved.account).toBe(
    change === "account" ? money.accounts.find((a) => a.label === "Savings")?.id : f.id,
  );
});
