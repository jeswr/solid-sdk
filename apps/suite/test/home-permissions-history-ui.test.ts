// AUTHORED-BY Claude Opus 5.5
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { click, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as unknown as PodSession,
  read: vi.fn(),
  revoke: vi.fn(),
  replace: vi.fn(),
  caps: {} as Record<string, boolean>,
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => mocks.session }));
vi.mock("../src/apps/home/lib/permissions/history", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readAccessHistory: mocks.read,
  revokeHistoryGrant: mocks.revoke,
}));
vi.mock("../src/shell/environment", () => ({
  useSuiteEnvironment: () => ({ SUITE_TEST_CAPS: mocks.caps }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => h("a", { href, className }, children),
}));
vi.mock("../src/apps/home/state/permissions", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  usePermissions: () => ({
    status: "loading",
    rows: [],
    failures: [],
    online: true,
    truncated: false,
    refresh: vi.fn(),
  }),
}));

import {
  EMPTY_ACTIVE,
  EMPTY_HISTORY,
  HistoryPage,
  PARTIAL_REVOKE,
  REVOKE_FAILED,
} from "../src/apps/home/components/permissions/history-page";
import { HistoryRoute } from "../src/apps/home/components/permissions/history-route";
import { PermissionsPage } from "../src/apps/home/components/permissions/permissions-page";
import { type HistoryEntry, HistoryRevokeError } from "../src/apps/home/lib/permissions/history";

vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);

const ROOT = "https://pod.test/";
const active: HistoryEntry = {
  receipt: `${ROOT}settings/access-records/receipt-1.ttl`,
  status: "granted",
  recipient: "https://maracoach.example/profile/card#me",
  purpose: { iri: "https://w3id.org/dpv#ServiceProvision", label: "Provide the service" },
  decidedAt: "2026-11-01T09:00:00.000Z",
  expiresAt: "2026-12-01T09:00:00.000Z",
  grant: {
    url: `${ROOT}settings/access-records/grant-1.ttl`,
    targets: [`${ROOT}activity/`, `${ROOT}health/sleep/`],
    role: "viewer",
  },
};
const denied: HistoryEntry = {
  receipt: `${ROOT}settings/access-records/receipt-2.ttl`,
  status: "denied",
  recipient: "https://adtracker.example/#me",
  decidedAt: "2026-10-01T09:00:00.000Z",
};
const removed: HistoryEntry = {
  ...active,
  receipt: `${ROOT}settings/access-records/receipt-3.ttl`,
  status: "revoked",
  revokedAt: "2026-11-05T09:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caps = { accessRequests: true };
  mocks.session = {
    mode: "demo",
    webId: `${ROOT}profile#me`,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch: vi.fn<typeof fetch>(),
    subscribe: () => () => {},
    reset: async () => {},
  };
  mocks.read.mockResolvedValue([active, denied, removed]);
  mocks.revoke.mockResolvedValue(undefined);
});

function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No ${name} button`);
  return found;
}
function confirmDialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!found) throw new Error("No confirmation");
  return found;
}

it("lists approvals still shared, with their places, and every answer", async () => {
  const view = await mount(h(HistoryPage));
  expect(mocks.read).toHaveBeenCalledWith(mocks.session.fetch, ROOT);
  const row = view.host.querySelector('[aria-label="Access shared with maracoach.example"]');
  expect(row?.textContent).toContain("Can see · 2 places");
  expect(row?.querySelector('[aria-label="Places shared"]')?.textContent).toBe(
    "activity/health/sleep/",
  );
  expect(row?.textContent).toContain("Provide the service");
  expect(row?.textContent).toContain("Recorded until Dec 1, 2026");
  // Revoked and denied answers are history only: neither offers Remove access.
  expect(view.host.querySelectorAll('[aria-label^="Access shared with"]')).toHaveLength(1);
  expect(view.host.querySelector('[aria-label="Denied: adtracker.example"]')).not.toBeNull();
  expect(
    view.host.querySelector('[aria-label="Access removed: maracoach.example"]')?.textContent,
  ).toContain("Removed Nov 5, 2026");
});

it("asks before removing access, then revokes that approval and reads the history again", async () => {
  const view = await mount(h(HistoryPage));
  const row = view.host.querySelector('[aria-label="Access shared with maracoach.example"]');
  await click(button(row as Element, "Remove access"));
  expect(confirmDialog().textContent).toContain("Remove maracoach.example's access?");
  expect(confirmDialog().textContent).toContain("2 places");
  await click(button(confirmDialog(), "Keep access"));
  expect(mocks.revoke).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue([{ ...active, status: "revoked" }, denied]);
  await click(button(row as Element, "Remove access"));
  await click(button(confirmDialog(), "Remove access"));
  expect(mocks.revoke).toHaveBeenCalledWith(active, {
    fetch: mocks.session.fetch,
    webId: `${ROOT}profile#me`,
    storage: ROOT,
  });
  expect(mocks.toast.success).toHaveBeenCalledWith("maracoach.example no longer has this access.");
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(view.host.textContent).toContain(EMPTY_ACTIVE);
});

it("keeps a partly revoked approval listed with a plain explanation", async () => {
  mocks.revoke.mockRejectedValueOnce(
    new HistoryRevokeError([`${ROOT}activity/`], [{ url: `${ROOT}health/sleep/`, error: 1 }]),
  );
  const view = await mount(h(HistoryPage));
  const row = () => view.host.querySelector('[aria-label="Access shared with maracoach.example"]');
  await click(button(row() as Element, "Remove access"));
  await click(button(confirmDialog(), "Remove access"));
  expect(row()?.querySelector('[role="alert"]')?.textContent).toBe(PARTIAL_REVOKE);
  expect(mocks.toast.success).not.toHaveBeenCalled();
  // Any other failure has fixed copy; the raw error only goes to the console.
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.revoke.mockRejectedValueOnce(new Error("https://pod.test/secret.acl 500"));
  await click(button(row() as Element, "Remove access"));
  await click(button(confirmDialog(), "Remove access"));
  expect(row()?.querySelector('[role="alert"]')?.textContent).toBe(REVOKE_FAILED);
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

it("shows empty, loading and retryable error states", async () => {
  mocks.read.mockResolvedValueOnce([]);
  const empty = await mount(h(HistoryPage));
  expect(empty.host.textContent).toContain(EMPTY_ACTIVE);
  expect(empty.host.textContent).toContain(EMPTY_HISTORY);
  await empty.unmount();
  mocks.read.mockRejectedValueOnce(new Error("down"));
  const failed = await mount(h(HistoryPage));
  await click(button(failed.host, "Retry"));
  expect(failed.host.querySelector('[aria-label="Denied: adtracker.example"]')).not.toBeNull();
  // A failed refresh keeps the history already shown.
  mocks.read.mockRejectedValueOnce(new Error("down"));
  mocks.revoke.mockRejectedValueOnce(new HistoryRevokeError([], []));
  const row = failed.host.querySelector('[aria-label="Access shared with maracoach.example"]');
  await click(button(row as Element, "Remove access"));
  await click(button(confirmDialog(), "Remove access"));
  expect(failed.host.querySelector('[aria-label="Denied: adtracker.example"]')).not.toBeNull();
});

it("is reached from Permissions beside Requests, and only where access requests exist", async () => {
  const page = await mount(h(PermissionsPage));
  expect(page.host.querySelector('a[href="/permissions/history"]')?.textContent).toBe("History");
  await page.unmount();
  const route = await mount(h(HistoryRoute));
  expect(route.host.querySelector("h1")?.textContent).toBe("History");
  expect(mocks.replace).not.toHaveBeenCalled();
  await route.unmount();
  mocks.caps = { accessRequests: false };
  const hidden = await mount(h(PermissionsPage));
  expect(hidden.host.querySelector('a[href="/permissions/history"]')).toBeNull();
  await hidden.unmount();
  await mount(h(HistoryRoute));
  expect(mocks.replace).toHaveBeenCalledWith("/permissions");
});
