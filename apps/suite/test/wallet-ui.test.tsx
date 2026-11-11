// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import type { WalletRecord } from "@jeswr/solid-wallet";
import { act, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemForm } from "@/apps/wallet/components/item-form";
import { WalletHome } from "@/apps/wallet/components/wallet-home";
import { createWalletState, type WalletState } from "@/apps/wallet/state/wallet-state";

let state: WalletState;
vi.mock("@/apps/wallet/state/wallet-context", () => ({
  useWallet: () => ({
    state,
    session: { mode: "demo" },
    snapshot: useSyncExternalStore(state.subscribe, state.getSnapshot),
  }),
}));
vi.mock("@/shell/sync/connection-state", () => ({ useConnectionState: () => "online" }));
vi.mock("@/shell/app-frame", () => ({
  AppHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/apps/wallet/components/item-detail", () => ({
  ItemDetail: ({ remove }: { remove: () => void }) => (
    <button type="button" onClick={remove}>
      Delete document
    </button>
  ),
}));
const item: WalletRecord = {
  url: "https://pod.example/wallet/one.ttl",
  etag: '"v1"',
  name: "Unverified credential",
  kind: "verifiable-credential",
  credential: "https://pod.example/wallet/credentials/one.json",
  created: new Date("2026-11-11"),
  modified: new Date("2026-11-11"),
  expires: new Date("2099-01-01"),
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = createWalletState(
    {
      list: vi.fn(async () => [item]),
      remove: vi.fn(async () => {}),
    } as unknown as WalletState["repository"],
    vi.fn(),
  );
  await state.refresh();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  state.dispose();
  container.remove();
});
it("shows neutral credential cards with an asserted expiry and no validity claim", async () => {
  await act(async () => root.render(<WalletHome />));
  const card = container.querySelector("article");
  expect(card?.textContent).toContain("Expires 2099-01-01");
  expect(card?.textContent).not.toContain("Valid");
  expect(card?.querySelector(".lucide-shield-check")).toBeNull();
  expect(card?.querySelector(".lucide-file-text")).not.toBeNull();
});
it("bounds credential name and pasted JSON inputs", async () => {
  await act(async () => root.render(<ItemForm mode="credential" close={vi.fn()} />));
  expect(document.querySelector<HTMLInputElement>('input[id$="-vc-name"]')?.maxLength).toBe(1000);
  expect(document.querySelector<HTMLTextAreaElement>('textarea[id$="-json"]')?.maxLength).toBe(
    262_144,
  );
});
it("offers keyboard undo while preserving undo inside text fields", async () => {
  await act(async () => root.render(<WalletHome />));
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === item.name,
  );
  await act(async () => open?.click());
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Delete document")
      ?.click(),
  );
  const undo = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Undo",
  );
  expect(undo?.getAttribute("aria-keyshortcuts")).toBe("Control+Z Meta+Z");
  const search = container.querySelector<HTMLInputElement>('input[type="search"]');
  await act(async () =>
    search?.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })),
  );
  expect(state.getSnapshot().items).toEqual([]);
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(state.getSnapshot().items).toEqual([item]);
  expect(container.querySelector(".wallet-undo")).toBeNull();
});
it("shows skipped record warnings without hiding valid cards", async () => {
  vi.mocked(state.repository.list).mockImplementationOnce(async (report) => {
    report?.("broken.ttl");
    return [item];
  });
  await state.refresh();
  await act(async () => root.render(<WalletHome />));
  expect(container.textContent).toContain("1 unreadable document skipped");
  expect(container.querySelector("article")?.textContent).toContain(item.name);
});
