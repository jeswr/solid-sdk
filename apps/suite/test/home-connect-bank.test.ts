// AUTHORED-BY Claude Opus 5.5
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { act, click, h, mount } from "./drive-ui-dom";

let session: { webId: string; storageUrl: string; fetch: typeof fetch };
let pod: ReturnType<typeof createDemoPod>;

vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => session,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import {
  bankChoiceProblem,
  bankOptions,
  bankStatementsAdapter,
  DEFAULT_BANK_CHOICE,
} from "../src/apps/home/components/connect/bank-options";
import { ConnectFlow } from "../src/apps/home/components/connect/flow";

// Synthetic exports only (the same layouts as @jeswr/pod-connectors' bank fixtures).
const HSBC =
  '01/07/2026,"Synthetic shop, main branch","-1,234.56"\r\n02/07/2026,Synthetic credit,2500.00\r\n';
const MONZO =
  "Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Local amount,Local currency\nsynthetic-1,01/07/2026,12:00:00,Card payment,Synthetic shop,,Shopping,-5.25,GBP,-6.00,EUR";
const BANK = `${DEMO_ROOT}integrations/bank-statements/finance/bank/`;

beforeEach(async () => {
  localStorage.clear();
  pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
  });
  session = { webId: DEMO_WEBID, storageUrl: DEMO_ROOT, fetch: pod.fetch };
});
afterEach(() => vi.restoreAllMocks());

/** Account folders under the connector's finance/bank/ container. */
function accountFolders(): string[] {
  return [
    ...new Set(
      pod
        .snapshot()
        .resources.map(([url]) => url)
        .filter((url) => url.startsWith(BANK) && url.length > BANK.length)
        .map((url) => url.slice(BANK.length).split("/")[0] as string),
    ),
  ].sort();
}
async function body(url: string): Promise<string> {
  return (await pod.fetch(url)).text();
}

describe("bank statement choices", () => {
  it("maps Auto-detect and an empty label to the default adapter options", () => {
    expect(bankOptions(DEFAULT_BANK_CHOICE)).toEqual({});
    expect(bankOptions({ format: "auto", accountLabel: "   " })).toEqual({});
    expect(bankOptions({ format: "monzo", accountLabel: "  Joint  " })).toEqual({
      csvFormat: "monzo",
      accountLabel: "Joint",
    });
    expect(bankChoiceProblem(DEFAULT_BANK_CHOICE)).toBeUndefined();
  });

  it("requires a label for HSBC UK and applies the adapter's label rules", () => {
    expect(bankChoiceProblem({ format: "hsbc-uk", accountLabel: "" })).toMatch(
      /account label to import an HSBC UK statement/,
    );
    expect(bankChoiceProblem({ format: "hsbc-uk", accountLabel: " \t " })).toMatch(/HSBC UK/);
    expect(bankChoiceProblem({ format: "hsbc-uk", accountLabel: "Everyday" })).toBeUndefined();
    expect(bankChoiceProblem({ format: "auto", accountLabel: "\u0001" })).toMatch(/visible text/);
    expect(bankChoiceProblem({ format: "auto", accountLabel: "x".repeat(257) })).toMatch(
      /at most 256 characters/,
    );
    expect(bankChoiceProblem({ format: "auto", accountLabel: "x".repeat(256) })).toBeUndefined();
    expect(bankStatementsAdapter({ format: "hsbc-uk", accountLabel: "Everyday" }).metadata.id).toBe(
      "bank-statements",
    );
  });
});

async function openImport() {
  const mounted = await mount(h(ConnectFlow, { service: "bank-statements" }));
  const continueButton = [...mounted.host.querySelectorAll("button")].find(
    (item) => item.textContent === "Continue",
  );
  if (!continueButton) throw new Error("Missing Continue button");
  await click(continueButton);
  return mounted;
}
function byLabel<T extends HTMLElement>(host: HTMLElement, text: string): T {
  const label = [...host.querySelectorAll("label")].find((item) =>
    item.textContent?.startsWith(text),
  );
  const control = label?.htmlFor ? host.querySelector<T>(`#${label.htmlFor}`) : null;
  if (!control) throw new Error(`Missing control labelled ${text}`);
  return control;
}
function chooseFile(host: HTMLElement): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "Choose file",
  );
  if (!found) throw new Error("Missing Choose file button");
  return found;
}
async function selectFormat(select: HTMLSelectElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set?.call(
      select,
      value,
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function typeLabel(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function upload(host: HTMLElement, name: string, text: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Missing export input");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([text], name, { type: "text/csv" })],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  // Let the import run inside act, so each of its state updates renders before the check.
  const heading = () => host.querySelector(".hm-connect-result h2")?.textContent ?? "";
  for (let tick = 0; tick < 500 && !heading().startsWith("Added "); tick++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(heading()).toMatch(/^Added /);
}
async function syncAgain(host: HTMLElement) {
  const again = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === "Sync again",
  );
  if (!again) throw new Error("Missing Sync again button");
  await click(again);
  const next = [...host.querySelectorAll("button")].find((item) => item.textContent === "Continue");
  if (next) await click(next);
}

describe("bank statements connect flow", () => {
  it("labels a format select (Auto-detect by default) and an optional account label", async () => {
    const { host } = await openImport();
    const select = byLabel<HTMLSelectElement>(host, "Bank format");
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("auto");
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ["auto", "Auto-detect"],
      ["revolut", "Revolut"],
      ["hsbc-uk", "HSBC UK"],
      ["monzo", "Monzo"],
      ["starling", "Starling"],
    ]);
    const label = byLabel<HTMLInputElement>(host, "Account label");
    expect(host.querySelector(`label[for="${label.id}"]`)?.textContent).toBe(
      "Account label (optional)",
    );
    expect(label.required).toBe(false);
    expect(label.maxLength).toBe(256);
    expect(host.querySelector("fieldset legend")?.textContent).toBe("Statement details");
    expect(chooseFile(host).disabled).toBe(false);
  });

  it("requires a label for HSBC UK, explains why and blocks the file picker until given", async () => {
    const { host } = await openImport();
    await selectFormat(byLabel<HTMLSelectElement>(host, "Bank format"), "hsbc-uk");
    const label = byLabel<HTMLInputElement>(host, "Account label");
    expect(host.querySelector(`label[for="${label.id}"]`)?.textContent).toBe(
      "Account label (required)",
    );
    expect(label.required).toBe(true);
    expect(label.getAttribute("aria-invalid")).toBe("true");
    const described = (label.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => host.querySelector(`#${id}`)?.textContent)
      .join(" ");
    expect(described).toMatch(/don't say which account they're from/);
    expect(described).toMatch(/Enter an account label to import an HSBC UK statement/);
    const problem = host.querySelector("#bank-options-problem");
    expect(problem?.getAttribute("aria-live")).toBe("polite");
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput?.disabled).toBe(true);
    expect(chooseFile(host).disabled).toBe(true);
    expect(chooseFile(host).getAttribute("aria-describedby")).toBe("bank-options-problem");
    // A dropped file is ignored while the choice is incomplete: nothing is written.
    const drop = host.querySelector(".hm-connect-drop");
    await act(() => {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { files: [new File([HSBC], "hsbc.csv")] },
      });
      drop?.dispatchEvent(event);
    });
    expect(host.querySelector(".hm-connect-result h2")?.textContent).toBe("Import a file");
    expect(accountFolders()).toEqual([]);
    await typeLabel(label, "Everyday HSBC");
    expect(label.getAttribute("aria-invalid")).toBeNull();
    expect(problem?.textContent).toBe("");
    expect(fileInput?.disabled).toBe(false);
    expect(chooseFile(host).disabled).toBe(false);
    expect(chooseFile(host).getAttribute("aria-describedby")).toBeNull();
  });

  it("imports an HSBC UK statement with the chosen format and label", async () => {
    const { host } = await openImport();
    await selectFormat(byLabel<HTMLSelectElement>(host, "Bank format"), "hsbc-uk");
    await typeLabel(byLabel<HTMLInputElement>(host, "Account label"), "  Everyday HSBC ");
    await upload(host, "hsbc.csv", HSBC);
    // The account and its two transactions.
    expect(host.querySelector(".hm-connect-result h2")?.textContent).toBe(
      "Added 3 items to Financial",
    );
    const folders = accountFolders();
    expect(folders).toEqual([expect.stringMatching(/^hsbc-uk-[0-9a-f]{64}$/)]);
    expect(await body(`${BANK}${folders[0]}/account.ttl`)).toContain('"Everyday HSBC"');
    const month = await body(`${BANK}${folders[0]}/2026-07.ttl`);
    expect(month).toContain("Synthetic shop, main branch");
    expect(month).toContain("Synthetic credit");
  });

  it("explains the HSBC UK choice when Auto-detect cannot read a headerless statement", async () => {
    const { host } = await openImport();
    await upload(host, "hsbc.csv", HSBC);
    expect(accountFolders()).toEqual([]);
    expect(host.textContent).toContain(
      "If this is an HSBC UK statement, choose HSBC UK as the bank format",
    );
  });

  it("keeps two Monzo accounts apart when their labels differ", async () => {
    const { host } = await openImport();
    await typeLabel(byLabel<HTMLInputElement>(host, "Account label"), "Joint account");
    await upload(host, "joint.csv", MONZO);
    await syncAgain(host);
    // The choice survives Sync again; only the label changes.
    expect(byLabel<HTMLInputElement>(host, "Account label").value).toBe("Joint account");
    await selectFormat(byLabel<HTMLSelectElement>(host, "Bank format"), "monzo");
    await typeLabel(byLabel<HTMLInputElement>(host, "Account label"), "Personal account");
    await upload(host, "personal.csv", MONZO);
    const folders = accountFolders();
    expect(folders).toEqual([
      expect.stringMatching(/^monzo-[0-9a-f]{64}$/),
      expect.stringMatching(/^monzo-[0-9a-f]{64}$/),
    ]);
    const accounts = await Promise.all(
      folders.map((folder) => body(`${BANK}${folder}/account.ttl`)),
    );
    expect(accounts.filter((doc) => doc.includes('"Joint account"'))).toHaveLength(1);
    expect(accounts.filter((doc) => doc.includes('"Personal account"'))).toHaveLength(1);
  });
});
