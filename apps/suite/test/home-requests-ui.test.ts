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
  UNREADABLE_TITLE,
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
async function review(onDone = vi.fn(), entry: Readable = request) {
  const view = await mount(h(RequestReview, { entry, onDone }));
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
  // The unreadable notification gets its own row, counted as waiting.
  const unreadable = view.host.querySelector(`[aria-label="${UNREADABLE_TITLE}"]`);
  expect(unreadable?.querySelector("h3")?.textContent).toBe("Couldn't read this request");
  expect([...(unreadable?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
    "Deny",
  ]);
  expect(view.host.querySelector(".hm-permission-count")?.textContent).toBe("2 waiting");
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
  // An expiry was sent and the storage won't enforce it: the owner is told to remove it later.
  expect(mocks.toast.success).toHaveBeenCalledWith(
    "MaraCoach can now see your Activity. We couldn't tell MaraCoach; they'll see it next time they check. Access won't end automatically on this storage; remove it from Permissions when you're done.",
  );
  expect(onDone).toHaveBeenCalledWith("approved");
});

it("says nothing about expiry when Until revoked was chosen, or when the storage enforces it", async () => {
  mocks.caps = { accessRequests: true, grantExpiry: true };
  const { view } = await review();
  await click(
    [...dialog().querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (item) => item.textContent === "Until revoked",
    ) as HTMLElement,
  );
  await click(button(dialog(), "Share"));
  expect(mocks.decide.mock.calls[0]?.[1]).not.toHaveProperty("expiresAt");
  expect(mocks.toast.success).toHaveBeenLastCalledWith(
    "MaraCoach can now see your Activity and Vitals. We couldn't tell MaraCoach; they'll see it next time they check.",
  );
  await view.unmount();
  mocks.decide.mockResolvedValueOnce({
    status: "approved",
    receiptUrl: `${ROOT}r`,
    notified: true,
    expiryEnforced: true,
  });
  await review();
  await click(button(dialog(), "Share"));
  expect(mocks.decide.mock.calls[1]?.[1]).toHaveProperty("expiresAt");
  expect(mocks.toast.success).toHaveBeenLastCalledWith(
    "MaraCoach can now see your Activity and Vitals.",
  );
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

it("offers a retry when offline that runs the same decision again", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  mocks.decide.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const { onDone } = await review();
  await click(checkbox(dialog(), "Vitals"));
  await click(button(dialog(), "Share"));
  expect(dialog().textContent).toContain("You're offline. Reconnect and try again.");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await click(button(dialog(), "Retry"));
  expect(mocks.decide).toHaveBeenCalledTimes(2);
  expect(mocks.decide.mock.calls[1]?.[1]).toEqual(mocks.decide.mock.calls[0]?.[1]);
  expect(mocks.decide.mock.calls[1]?.[1]).toEqual({ approve: true, dataTypes: [ACTIVITY_CLASS] });
  expect(onDone).toHaveBeenCalledWith("approved");
});

it("shows known SDK refusals in plain words; Retry re-runs a retryable denial", async () => {
  mocks.decide.mockRejectedValueOnce(
    new Error("Every approved data type needs an owner registration"),
  );
  await review();
  await click(button(dialog(), "Share"));
  let alert = dialog().querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(
    "Some of this data isn't registered in your pod, so it can't be shared from here.",
  );
  expect(alert?.textContent).not.toContain("owner registration");
  expect(alert?.querySelector("button")).toBeNull();
  mocks.decide.mockRejectedValueOnce(new Error("Conditional write failed (412)"));
  await click(button(dialog(), "Cancel"));
  await click(button(document.querySelector('[role="alertdialog"]') as HTMLElement, "Deny"));
  alert = dialog().querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Something else changed this request at the same time.");
  mocks.decide.mockResolvedValueOnce({
    status: "denied",
    receiptUrl: `${ROOT}r`,
    notified: true,
    expiryEnforced: false,
  });
  await click(button(alert as Element, "Retry"));
  expect(mocks.decide).toHaveBeenCalledTimes(3);
  expect(mocks.decide.mock.calls[2]?.[1]).toEqual({ approve: false });
  expect(mocks.toast.success).toHaveBeenCalledWith("You denied MaraCoach's request.");
});

it("never offers Change account (Home answers on its own session), and dismisses on Escape", async () => {
  mocks.accounts = [
    { id: "a", name: "Alice", webId: "https://a.test/#me" },
    { id: "b", name: "", webId: "https://b.test/#me" },
  ];
  const { onDone } = await review();
  expect(dialog().textContent).not.toContain("Change account");
  expect(dialog().querySelector("select")).toBeNull();
  await key(dialog(), "Escape");
  expect(onDone).toHaveBeenCalledWith("dismissed");
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(mocks.switchTo).not.toHaveBeenCalled();
});

it("finishes an interrupted approval read-only, resuming the pinned choices", async () => {
  mocks.caps = { accessRequests: true, grantExpiry: true };
  const approving: Readable = { ...request, status: "approving" };
  const { onDone } = await review(vi.fn(), approving);
  const sheet = dialog();
  expect(sheet.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
  expect(sheet.querySelector('[role="radio"]')).toBeNull();
  expect(sheet.textContent).not.toContain("Deny");
  expect(sheet.textContent).not.toContain("Cancel");
  expect(sheet.textContent).toContain("approving didn't finish");
  const names = [...sheet.querySelectorAll("button")].map((item) => item.textContent?.trim());
  expect(names).toContain("Finish approving");
  expect(names).toContain("Not now");
  mocks.decide.mockRejectedValueOnce(new Error("Cannot approve a denial"));
  await click(button(sheet, "Finish approving"));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "You already denied this request, so it can't be approved.",
  );
  await click(button(dialog(), "Finish approving"));
  expect(mocks.decide).toHaveBeenCalledTimes(2);
  for (const call of mocks.decide.mock.calls) expect(call[1]).toEqual({ approve: true });
  // The toast comes from the result, never from cards nobody chose here.
  expect(mocks.toast.success).toHaveBeenCalledWith(
    "You finished approving MaraCoach's request. We couldn't tell MaraCoach; they'll see it next time they check.",
  );
  expect(onDone).toHaveBeenCalledWith("approved");
});

it("labels an interrupted approval's row Finish approving", async () => {
  mocks.list.mockResolvedValue([{ ...request, status: "approving" }]);
  const view = await mount(h(RequestsPage));
  const row = view.host.querySelector('[aria-label="Request from MaraCoach"]') as Element;
  expect(row.textContent).toContain("Approving didn't finish");
  await click(button(row, "Finish approving"));
  expect(button(dialog(), "Finish approving")).toBeDefined();
});

it("plain-words the refusals of a stale or interrupted approval", async () => {
  mocks.decide.mockRejectedValueOnce(
    new Error(`Request ${request.id} is still finishing with different choices; finish it first`),
  );
  await review();
  await click(button(dialog(), "Share"));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "An earlier approval of this request is still finishing. Close this and choose Finish approving.",
  );
  mocks.decide.mockRejectedValueOnce(new Error("Cannot deny an approval"));
  await click(button(dialog(), "Cancel"));
  await click(button(document.querySelector('[role="alertdialog"]') as HTMLElement, "Deny"));
  expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
    "Approving this request has already started, so it can't be denied now.",
  );
});

it("leaves unsorted classes unchecked, named by class with the full IRI beneath", async () => {
  const thing = "https://vocab.example/ns#Thing";
  const other = "https://other.example/types/Thing";
  const entry: Readable = {
    ...request,
    dataTypes: [ACTIVITY_CLASS, thing, other],
    modesByType: { [ACTIVITY_CLASS]: ["read"], [thing]: ["read"], [other]: ["read"] },
  };
  await review(vi.fn(), entry);
  const sheet = dialog();
  const cards = [...sheet.querySelectorAll(".hm-request-card")];
  expect(cards.map((card) => card.querySelector("label")?.textContent)).toEqual([
    "Activity",
    "Thing",
    "Thing",
  ]);
  expect(cards[1]?.querySelector(".hm-request-iri")?.textContent).toBe(thing);
  expect(cards[2]?.querySelector(".hm-request-iri")?.textContent).toBe(other);
  const states = cards.map((card) =>
    card.querySelector('[role="checkbox"]')?.getAttribute("data-state"),
  );
  expect(states).toEqual(["checked", "unchecked", "unchecked"]);
  expect(checkbox(sheet, "Select all").getAttribute("data-state")).toBe("indeterminate");
  await click(cards[2]?.querySelector('[role="checkbox"]') as HTMLElement);
  await click(button(sheet, "Share"));
  expect(mocks.decide.mock.calls[0]?.[1]).toEqual({
    approve: true,
    dataTypes: [ACTIVITY_CLASS, other],
  });
});

it("keeps add-only data unchecked and disabled, and Share off when nothing shareable is checked", async () => {
  const note = "https://vocab.example/ns#Note";
  const entry: Readable = {
    ...request,
    dataTypes: [ACTIVITY_CLASS, note],
    modes: ["read", "append"],
    modesByType: { [ACTIVITY_CLASS]: ["read"], [note]: ["append"] },
  };
  await review(vi.fn(), entry);
  const sheet = dialog();
  const [activity, add] = [...sheet.querySelectorAll(".hm-request-card")] as [Element, Element];
  const addBox = add.querySelector('[role="checkbox"]') as HTMLButtonElement;
  expect(addBox.disabled).toBe(true);
  expect(addBox.getAttribute("data-state")).toBe("unchecked");
  expect(add.textContent).toContain("Can only add — can't be shared yet");
  expect(activity.textContent).toContain("Can see");
  expect(checkbox(sheet, "Select all").getAttribute("data-state")).toBe("checked");
  await click(checkbox(sheet, "Activity"));
  expect(button(sheet, "Share").disabled).toBe(true);
  await click(checkbox(sheet, "Select all"));
  expect(addBox.getAttribute("data-state")).toBe("unchecked");
  expect(button(sheet, "Share").disabled).toBe(false);
  await click(button(sheet, "Share"));
  expect(mocks.decide.mock.calls[0]?.[1]).toEqual({ approve: true, dataTypes: [ACTIVITY_CLASS] });
});

it("disables Select all and Share when nothing in the request can be shared", async () => {
  const note = "https://vocab.example/ns#Note";
  await review(vi.fn(), {
    ...request,
    dataTypes: [note],
    modes: ["append"],
    modesByType: { [note]: ["append"] },
  });
  const sheet = dialog();
  expect((checkbox(sheet, "Select all") as HTMLButtonElement).disabled).toBe(true);
  expect(button(sheet, "Share").disabled).toBe(true);
});

it("denies an unreadable request from its row, or says plainly when it can't be", async () => {
  const bad: AccessRequestEntry = { id: `${ROOT}inbox/bad`, status: "unreadable" };
  mocks.list.mockResolvedValue([bad]);
  const view = await mount(h(RequestsPage));
  const row = () => view.host.querySelector(`[aria-label="${UNREADABLE_TITLE}"]`);
  expect(view.host.textContent).not.toContain(EMPTY_PENDING);
  const deny = async () => {
    await click(button(row() as Element, "Deny"));
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(confirm?.textContent).toContain("Deny this request?");
    await click(button(confirm as HTMLElement, "Deny"));
  };
  mocks.decide.mockRejectedValueOnce(new Error("Unreadable access request"));
  await deny();
  expect(mocks.decide).toHaveBeenCalledWith(bad, { approve: false }, expect.anything());
  expect(row()?.querySelector('[role="alert"]')?.textContent).toBe(
    "This request couldn't be read, so it can't be answered here.",
  );
  // Asking again can't help, so the Deny button goes.
  expect(row()?.querySelector("button")).toBeNull();
  await view.unmount();

  mocks.decide.mockResolvedValueOnce({
    status: "denied",
    receiptUrl: `${ROOT}r`,
    notified: false,
    expiryEnforced: false,
  });
  mocks.list.mockResolvedValueOnce([bad]).mockResolvedValue([]);
  mocks.session = { ...mocks.session, fetch: vi.fn<typeof fetch>() };
  const again = await mount(h(RequestsPage));
  const fresh = again.host.querySelector(`[aria-label="${UNREADABLE_TITLE}"]`) as Element;
  await click(button(fresh, "Deny"));
  await click(button(document.querySelector('[role="alertdialog"]') as HTMLElement, "Deny"));
  expect(mocks.toast.success).toHaveBeenCalledWith("You denied the request.");
  expect(again.host.querySelector(`[aria-label="${UNREADABLE_TITLE}"]`)).toBeNull();
  expect(again.host.textContent).toContain(EMPTY_PENDING);
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
