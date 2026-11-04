// AUTHORED-BY Claude Opus 5.5
import "./drive-ui-dom";
import { readFile } from "node:fs/promises";
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { beforeEach, expect, it, vi } from "vitest";
import { act, click, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  createManualItem: vi.fn(),
  registerManualType: vi.fn(),
  refresh: vi.fn(async () => {}),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
const session = {
  mode: "demo",
  storageUrl: "https://pod.example/alice/",
  webId: "https://pod.example/alice/profile/card#me",
  displayName: "Alice",
  fetch: vi.fn(),
  subscribe: () => () => {},
  reset: async () => {},
};
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => session }));
vi.mock("../src/apps/home/state/use-domain-items", () => ({
  domainStore: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../src/apps/home/components/item/manual-data", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createManualItem: mocks.createManualItem,
  registerManualType: mocks.registerManualType,
}));
vi.mock("../src/apps/home/lib/templates", async (original) => {
  const real = await original<typeof import("../src/apps/home/lib/templates")>();
  const fromDisk: typeof fetch = async (input) =>
    new Response(await readFile(input as URL, "utf8"));
  return {
    ...real,
    loadTemplate: (classIri: string, url: string) => real.loadTemplate(classIri, url, fromDisk),
  };
});

const { AddManuallySheet } = await import("../src/apps/home/components/item/add-manually-sheet");
const { ManualRegistrationError } = await import("../src/apps/home/components/item/manual-data");
const { DOMAINS } = await import("../src/apps/home/lib/model/domains");
const domain = DOMAINS.find((entry) =>
  entry.dataTypes.some((type) => type.manualForm),
) as (typeof DOMAINS)[number];

beforeEach(() => {
  vi.clearAllMocks();
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((element) => element.textContent === name);
async function waitFor(check: () => unknown) {
  for (let attempt = 0; attempt < 50 && !check(); attempt++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(check()).toBeTruthy();
}
/** Open the sheet, fill the required fields and save into a failing registration. */
async function savedButUnregistered() {
  const onOpenChange = vi.fn();
  mocks.createManualItem.mockRejectedValueOnce(
    new ManualRegistrationError(
      `${session.storageUrl}personal/home-1.ttl`,
      new Error("Your profile keeps its settings somewhere else."),
    ),
  );
  await mount(h(AddManuallySheet, { domain, open: true, onOpenChange, returnFocus: () => {} }));
  await waitFor(() => document.querySelector("form.hm-item-form"));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  for (const label of document.querySelectorAll("label")) {
    if (!label.textContent?.includes("(required)")) continue;
    const input = document.getElementById(label.htmlFor) as HTMLInputElement;
    await act(() => {
      setter?.call(input, "Home");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await click(button("Save") as HTMLButtonElement);
  await waitFor(() => button("Retry registration"));
  return onOpenChange;
}

it("keeps a saved item recoverable with the registration reason, Retry and Skip", async () => {
  const onOpenChange = await savedButUnregistered();
  expect(document.querySelector("[role=alert]")?.textContent).toBe(
    "Your profile keeps its settings somewhere else.",
  );
  expect(document.body.textContent).toContain("Your item is saved.");
  // The form is gone, so a second save cannot create a duplicate item.
  expect(document.querySelector("form.hm-item-form")).toBeNull();
  expect(button("Skip registration")).toBeDefined();
  // A technical failure on retry is replaced by plain copy; the item stays recoverable.
  mocks.registerManualType.mockRejectedValueOnce(
    new RdfFetchError("GET https://pod.example/alice/settings failed", { status: 500 }),
  );
  await click(button("Retry registration") as HTMLButtonElement);
  await waitFor(() =>
    document.querySelector("[role=alert]")?.textContent?.includes("Please try again"),
  );
  expect(document.body.textContent).not.toContain("https://");
  expect(button("Retry registration")).toBeDefined();
  // Retry registers only; it never re-creates the item.
  mocks.registerManualType.mockResolvedValueOnce(undefined);
  await click(button("Retry registration") as HTMLButtonElement);
  await waitFor(() => onOpenChange.mock.calls.length);
  expect(mocks.createManualItem).toHaveBeenCalledOnce();
  expect(mocks.registerManualType).toHaveBeenCalledTimes(2);
  expect(mocks.registerManualType).toHaveBeenLastCalledWith(
    session,
    expect.any(String),
    expect.stringMatching(/^https:\/\/pod\.example\/alice\//),
  );
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(mocks.toast.success).toHaveBeenCalledOnce();
});

it("Skip registration keeps the item, refreshes Home and closes", async () => {
  const onOpenChange = await savedButUnregistered();
  await click(button("Skip registration") as HTMLButtonElement);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(mocks.registerManualType).not.toHaveBeenCalled();
});
