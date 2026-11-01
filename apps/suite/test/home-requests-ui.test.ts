// AUTHORED-BY Claude Opus 5.5
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, click, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  session: undefined as unknown as PodSession,
  list: vi.fn(),
  decide: vi.fn(),
  caps: {} as Record<string, boolean>,
  accounts: [] as { id: string; name: string; webId: string }[],
  switchTo: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => mocks.session }));
vi.mock("@jeswr/pod-access/requests-solid", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listRequests: mocks.list,
  decide: mocks.decide,
}));
vi.mock("../src/shell/environment", () => ({
  useSuiteEnvironment: () => ({ SUITE_TEST_CAPS: mocks.caps }),
}));
vi.mock("../src/shell/session/accounts-provider", () => ({
  useAccounts: () => ({
    accounts: mocks.accounts,
    active: mocks.accounts[0] ?? null,
    switchTo: mocks.switchTo,
  }),
}));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
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

import {
  type AccessRequestEntry,
  RequestConflictError,
  UnsupportedAccessModelError,
} from "@jeswr/pod-access/requests-solid";
import {
  EXPIRY_UNAVAILABLE,
  RequestReview,
} from "../src/apps/home/components/requests/request-review";
import {
  EMPTY_DECIDED,
  EMPTY_PENDING,
  RequestsPage,
} from "../src/apps/home/components/requests/requests-page";
import { ACTIVITY_CLASS } from "../src/lib/demo-pod/seed-requests";

vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
vi.stubGlobal("HTMLButtonElement", window.HTMLButtonElement);

const ROOT = "https://pod.test/";
const SLEEP = "https://jeswr.org/ns/sectors/health#SleepObservation";
type Readable = Exclude<AccessRequestEntry, { status: "unreadable" }>;
const request: Readable = {
  id: `${ROOT}inbox/1.ttl`,
  status: "pending",
  requester: "https://maracoach.example/profile/card#me",
  requesterName: "MaraCoach",
  purpose: "build your training plan",
  requestedDuration: "P1M",
  dataTypes: [ACTIVITY_CLASS, SLEEP],
  modes: ["read"],
  modesByType: { [ACTIVITY_CLASS]: ["read"], [SLEEP]: ["read"] },
  created: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caps = { accessRequests: true };
  mocks.accounts = [];
  mocks.session = {
    mode: "demo",
    webId: `${ROOT}profile#me`,
    displayName: "Alice",
    storageUrl: ROOT,
    // Home model discovery finds nothing here, so cards show no counts.
    fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 404 })),
    subscribe: () => () => {},
    reset: async () => {},
  };
  mocks.list.mockResolvedValue([request]);
  mocks.decide.mockResolvedValue({
    status: "approved",
    receiptUrl: `${ROOT}r`,
    notified: false,
    expiryEnforced: false,
  });
});

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error("No review dialog");
  return found;
}
function button(root: ParentNode, name: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No ${name} button`);
  return found;
}
function checkbox(root: ParentNode, label: string): HTMLButtonElement {
  const forId = [...root.querySelectorAll("label")].find(
    (item) => item.textContent === label,
  )?.htmlFor;
  const found = forId ? root.querySelector<HTMLButtonElement>(`#${CSS.escape(forId)}`) : null;
  if (!found) throw new Error(`No ${label} checkbox`);
  return found;
}
async function review(onDone = vi.fn()) {
  const view = await mount(h(RequestReview, { entry: request, onDone }));
  return { view, onDone };
}

it("lists pending requests with requester, data types, purpose, duration and Review", async () => {
  mocks.list.mockResolvedValue([request, { id: `${ROOT}inbox/bad`, status: "unreadable" }]);
  const view = await mount(h(RequestsPage));
  const row = view.host.querySelector('[aria-label="Request from MaraCoach"]');
  expect(row?.querySelector("h3")?.textContent).toBe("MaraCoach");
  expect(row?.textContent).toContain("maracoach.example");
  expect(row?.querySelector(".hm-request-types")?.textContent).toBe("Activity, Vitals");
  expect(row?.textContent).toContain("Build your training plan");
  expect(row?.textContent).toContain("For 1 month");
  expect(row?.textContent).not.toContain("https://");
  expect(view.host.textContent).toContain("1 request couldn't be read");
  expect(view.host.querySelector(".hm-permission-count")?.textContent).toBe("1 waiting");
  await click(button(row as Element, "Review"));
  expect(dialog().textContent).toContain(
    "To build your training plan, MaraCoach requests access to:",
  );
});

it("shows the exact empty copy and the 30-day decided history", async () => {
  mocks.list.mockResolvedValue([
    { ...request, status: "denied", decidedAt: new Date().toISOString() },
  ]);
  const view = await mount(h(RequestsPage));
  expect(view.host.textContent).toContain(EMPTY_PENDING);
  expect(EMPTY_PENDING).toBe(
    "No requests waiting — when an app or person asks for access, it appears here.",
  );
  const decided = view.host.querySelectorAll<HTMLElement>('[role="tab"]')[1] as HTMLElement;
  await act(async () => {
    decided.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    decided.focus();
  });
  const panel = view.host.querySelector('[role="tabpanel"][data-state="active"]');
  expect(panel?.textContent).toContain("Denied");
  expect(panel?.querySelector("button")).toBeNull();
  expect(EMPTY_DECIDED).toBe("No requests decided in the last 30 days.");
});

it("renders loading and retryable error states", async () => {
  mocks.list.mockRejectedValueOnce(new Error("down"));
  const view = await mount(h(RequestsPage));
  const retry = button(view.host, "Retry");
  await click(retry);
  await vi.waitFor(() =>
    expect(view.host.querySelector('[aria-label="Request from MaraCoach"]')).not.toBeNull(),
  );
});

it("checks every card by default; Select all and per-card checks gate Share", async () => {
  await review();
  const sheet = dialog();
  const share = button(sheet, "Share");
  const all = checkbox(sheet, "Select all");
  const activity = checkbox(sheet, "Activity");
  expect(all.getAttribute("data-state")).toBe("checked");
  expect(activity.getAttribute("data-state")).toBe("checked");
  expect(sheet.textContent).toContain("Exercise and step counts.");
  expect(sheet.textContent).toContain("Can see");
  expect(sheet.textContent).not.toMatch(/\d+ items?/);
  expect(share.disabled).toBe(false);
  await click(activity);
  expect(all.getAttribute("data-state")).toBe("indeterminate");
  await click(checkbox(sheet, "Vitals"));
  expect(all.getAttribute("data-state")).toBe("unchecked");
  expect(share.disabled).toBe(true);
  await click(all);
  expect(share.disabled).toBe(false);
  expect(checkbox(sheet, "Vitals").getAttribute("data-state")).toBe("checked");
  await click(all);
  expect(share.disabled).toBe(true);
});

it("gives Cancel and Share equal weight", async () => {
  await review();
  const sheet = dialog();
  const [cancel, share] = [button(sheet, "Cancel"), button(sheet, "Share")];
  expect(cancel.dataset.variant).toBe(share.dataset.variant);
  expect(cancel.dataset.size).toBe(share.dataset.size);
  expect(cancel.className).toBe(share.className);
  expect(cancel.parentElement).toBe(share.parentElement);
});

it("with expiring access, preselects the requested month and approves with that expiry", async () => {
  mocks.caps = { accessRequests: true, grantExpiry: true };
  const { onDone } = await review();
  const sheet = dialog();
  const month = [...sheet.querySelectorAll('[role="radio"]')].find(
    (item) => item.textContent === "1 month",
  );
  expect(month?.getAttribute("aria-checked")).toBe("true");
  expect(sheet.querySelector("fieldset")?.disabled).toBe(false);
  await click(checkbox(sheet, "Vitals"));
  const before = new Date();
  await click(button(sheet, "Share"));
  expect(mocks.decide).toHaveBeenCalledTimes(1);
  const [entry, decision, options] = mocks.decide.mock.calls[0] ?? [];
  expect(entry).toBe(request);
  expect(decision).toMatchObject({ approve: true, dataTypes: [ACTIVITY_CLASS] });
  const expected = new Date(before);
  expected.setMonth(expected.getMonth() + 1);
  expect(Math.abs((decision.expiresAt as Date).getTime() - expected.getTime())).toBeLessThan(5000);
  expect(options).toMatchObject({ fetch: mocks.session.fetch, storage: ROOT });
  expect(mocks.toast.success).toHaveBeenCalledWith(
    "MaraCoach can now see your Activity. We couldn't tell MaraCoach; they'll see it next time they check.",
  );
  expect(onDone).toHaveBeenCalledWith("approved");
});

it("without expiring access, disables the chips with a note and sends no expiry", async () => {
  mocks.decide.mockResolvedValueOnce({
    status: "approved",
    receiptUrl: `${ROOT}r`,
    notified: true,
    expiryEnforced: false,
  });
  await review();
  const sheet = dialog();
  expect(sheet.querySelector("fieldset")?.disabled).toBe(true);
  expect(sheet.textContent).toContain(EXPIRY_UNAVAILABLE);
  expect(EXPIRY_UNAVAILABLE).toBe("Expiring access isn't available on this storage");
  const untilRevoked = [...sheet.querySelectorAll('[role="radio"]')].find(
    (item) => item.textContent === "Until revoked",
  );
  expect(untilRevoked?.getAttribute("aria-checked")).toBe("true");
  await click(button(sheet, "Share"));
  expect(mocks.decide.mock.calls[0]?.[1]).toEqual({
    approve: true,
    dataTypes: [ACTIVITY_CLASS, SLEEP],
  });
  expect(mocks.toast.success).toHaveBeenCalledWith(
    "MaraCoach can now see your Activity and Vitals.",
  );
});

it("asks before denying: Keep reviewing returns, Deny decides once", async () => {
  mocks.decide.mockResolvedValue({
    status: "denied",
    receiptUrl: `${ROOT}r`,
    notified: false,
    expiryEnforced: false,
  });
  const { onDone } = await review();
  await click(button(dialog(), "Cancel"));
  let confirm = document.querySelector<HTMLElement>('[role="alertdialog"]');
  expect(confirm?.textContent).toContain("Deny this request?");
  await click(button(confirm as HTMLElement, "Keep reviewing"));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(mocks.decide).not.toHaveBeenCalled();
  await click(button(dialog(), "Cancel"));
  confirm = document.querySelector<HTMLElement>('[role="alertdialog"]');
  await click(button(confirm as HTMLElement, "Deny"));
  expect(mocks.decide).toHaveBeenCalledWith(request, { approve: false }, expect.anything());
  expect(mocks.toast.success).toHaveBeenCalledWith(
    "You denied MaraCoach's request. We couldn't tell MaraCoach; they'll see it next time they check.",
  );
  expect(onDone).toHaveBeenCalledWith("denied");
});

it("keeps the sheet open with the error's message, and closes on a lost race", async () => {
  mocks.decide.mockRejectedValueOnce(new UnsupportedAccessModelError("acp"));
  const { onDone } = await review();
  await click(button(dialog(), "Share"));
  const alert = dialog().querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Not available on this storage");
  expect(alert?.textContent).toContain("Approving requests isn't available on this storage yet");
  expect(onDone).not.toHaveBeenCalled();
  expect(button(dialog(), "Share").disabled).toBe(false);
  mocks.decide.mockRejectedValueOnce(
    new Error("The access records folder is shared; make it private first"),
  );
  await click(button(dialog(), "Share"));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "The access records folder is shared; make it private first",
  );
  mocks.decide.mockRejectedValueOnce(new RequestConflictError(request.id, "approved"));
  await click(button(dialog(), "Share"));
  expect(mocks.toast.info).toHaveBeenCalledWith("This request was already decided");
  expect(onDone).toHaveBeenCalledWith("already-decided");
  expect(mocks.list).toHaveBeenCalledTimes(4);
});

it("offers a retry when offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  mocks.decide.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await review();
  await click(button(dialog(), "Share"));
  expect(dialog().textContent).toContain("You're offline. Reconnect and try again.");
  await click(button(dialog(), "Retry"));
  expect(dialog().querySelector('[role="alert"]')).toBeNull();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("offers Change account only with more than one account, and dismisses on Escape", async () => {
  const { view, onDone } = await review();
  expect(dialog().textContent).not.toContain("Change account");
  await view.unmount();
  mocks.accounts = [
    { id: "a", name: "Alice", webId: "https://a.test/#me" },
    { id: "b", name: "", webId: "https://b.test/#me" },
  ];
  await review(onDone);
  const select = dialog().querySelector("select") as HTMLSelectElement;
  expect(dialog().textContent).toContain("Change account");
  expect([...select.options].map((option) => option.textContent)).toEqual([
    "Alice",
    "https://b.test/#me",
  ]);
  await act(async () => {
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(mocks.switchTo).toHaveBeenCalledWith("b");
  await key(dialog(), "Escape");
  expect(onDone).toHaveBeenCalledWith("dismissed");
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("sends one decision for a double click", async () => {
  await review();
  const share = button(dialog(), "Share");
  await act(async () => {
    share.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    share.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(mocks.decide).toHaveBeenCalledTimes(1);
});
