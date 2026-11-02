// AUTHORED-BY Codex GPT-6.1-Sol
// Reuse the suite-ui DOM harness already used by the shell and Drive tests.
import { createRequire } from "node:module";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, deferred, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const axe = requireUi(
  "axe-core",
) as typeof import("../../../packages/suite-ui/node_modules/axe-core");

import { MemorySharingAdapter } from "../src/shell/share/memory-adapter";
import { RequestAccess } from "../src/shell/share/request-access";
import { ShareDialog, type ShareDialogProps } from "../src/shell/share/share-dialog";
import { type ShareCapabilities, ShareError, type SharingState } from "../src/shell/share/types";

const caps: ShareCapabilities = {
  publicLinks: true,
  authenticatedAgentGrants: true,
  grantExpiry: true,
  grantPurpose: true,
  notifyAgents: true,
  accessRequests: true,
  managerRole: true,
};
const initial: SharingState = {
  people: [
    { webId: "https://example.org/rowan#me", name: "Rowan Vale", role: "owner" },
    { webId: "https://example.org/ash#me", name: "Ash Reed", role: "viewer" },
    {
      webId: "https://example.org/ivo#me",
      name: "Ivo Marsh",
      role: "viewer",
      inherited: { from: "https://example.org/storage/", fromName: "My storage" },
    },
  ],
  general: { mode: "restricted" },
  canManage: true,
};
const url = "https://example.org/storage/notes";
const defaults = (adapter = new MemorySharingAdapter(initial, 0)): ShareDialogProps => ({
  open: true,
  onOpenChange: vi.fn(),
  adapter,
  caps,
  url,
  name: "Project notes",
  kind: "document",
  suiteHref: "https://suite.example/docs/d/notes",
});
beforeEach(() => {
  for (const name of [
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLButtonElement",
    "SVGElement",
    "DocumentFragment",
  ] as const)
    vi.stubGlobal(name, window[name]);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(cleanup);
async function loaded() {
  await screen.findByRole("heading", { name: "People with access" });
  return screen.getByRole("dialog");
}
async function accessible() {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical"),
  ).toEqual([]);
}
async function selectRawPerson() {
  const picker = screen.getByRole("combobox", { name: "Add people" });
  fireEvent.change(picker, { target: { value: "https://example.org/sage#me" } });
  fireEvent.keyDown(picker, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}
it("does not show an unconfirmed grant and locks the confirmed list after forbidden writes", async () => {
  const adapter = new MemorySharingAdapter(initial, 0);
  const pending = deferred<void>();
  vi.spyOn(adapter, "setPerson").mockImplementationOnce(() => pending.promise);
  render(h(ShareDialog, defaults(adapter)));
  await loaded();
  await selectRawPerson();
  expect(screen.getByText("Saving access…")).toBeTruthy();
  expect(screen.queryByRole("listitem", { name: "https://example.org/sage#me" })).toBeNull();
  await act(() => pending.reject(new ShareError("forbidden")));
  await screen.findByRole("alert");
  expect(screen.getByRole("listitem", { name: "Ash Reed" })).toBeTruthy();
  expect(
    (screen.getByRole("combobox", { name: "Role for Ash Reed" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(adapter.notifications).toHaveLength(0);
  await accessible();
});
it("changes a role, removes access and undoes only the confirmed removal", async () => {
  const adapter = new MemorySharingAdapter(initial, 0);
  render(h(ShareDialog, defaults(adapter)));
  await loaded();
  let row = screen.getByRole("listitem", { name: "Ash Reed" });
  fireEvent.keyDown(within(row).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Editor" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("listitem", { name: "Ash Reed" })).getByRole("combobox").textContent,
    ).toContain("Editor"),
  );
  row = screen.getByRole("listitem", { name: "Ash Reed" });
  fireEvent.keyDown(within(row).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Remove access" }));
  await waitFor(() => expect(screen.queryByRole("listitem", { name: "Ash Reed" })).toBeNull());
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(screen.getByRole("listitem", { name: "https://example.org/ash#me" })).toBeTruthy(),
  );
  expect(
    (await adapter.load(url, new AbortController().signal)).people.find(
      (person) => person.webId === "https://example.org/ash#me",
    )?.role,
  ).toBe("editor");
  await accessible();
});
it("keeps owner and inherited rows read-only and gates roles, expiry and general access", async () => {
  render(
    h(ShareDialog, {
      ...defaults(),
      kind: "folder",
      caps: {
        ...caps,
        managerRole: false,
        grantExpiry: false,
        grantPurpose: false,
        notifyAgents: false,
        publicLinks: false,
        authenticatedAgentGrants: false,
      },
    }),
  );
  await loaded();
  expect(
    within(screen.getByRole("listitem", { name: "Rowan Vale" })).queryByRole("combobox"),
  ).toBeNull();
  expect(
    (screen.getByRole("combobox", { name: "Role for Ivo Marsh" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole("link", { name: "Inherited from My storage" }).getAttribute("href")).toBe(
    "https://example.org/storage/",
  );
  expect((screen.getByRole("radio", { name: "1 day" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("What is this for?")).toBeNull();
  expect(screen.queryByText("Notify people")).toBeNull();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "New person's role" }), {
    key: "ArrowDown",
  });
  expect(screen.queryByRole("option", { name: "Manager" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Commenter" })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "General access" }), {
    key: "ArrowDown",
  });
  expect(
    screen.getByRole("option", { name: "Anyone with the link" }).getAttribute("aria-disabled"),
  ).toBe("true");
  expect(
    screen.getByRole("option", { name: "Anyone signed in" }).getAttribute("aria-disabled"),
  ).toBe("true");
  await accessible();
});
it("reacts to browser offline events and copies the suite URL", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(h(ShareDialog, defaults()));
  await loaded();
  await act(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.getByText("Reconnect to change sharing")).toBeTruthy();
  expect(
    (screen.getByRole("combobox", { name: "General access" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByText("Link copied");
  expect(writeText).toHaveBeenCalledWith("https://suite.example/docs/d/notes");
  await accessible();
});
it("restores focus to the opener after Done", async () => {
  const adapter = new MemorySharingAdapter(initial, 0);
  function Harness() {
    const [open, onOpenChange] = useState(false);
    return h(
      "main",
      {},
      h("button", { onClick: () => onOpenChange(true) }, "Open sharing"),
      h(ShareDialog, { ...defaults(adapter), open, onOpenChange }),
    );
  }
  render(h(Harness));
  const opener = screen.getByRole("button", { name: "Open sharing" });
  await act(() => opener.focus());
  fireEvent.click(opener);
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(opener);
});
it("requests access only after an accepted write, reports errors, retries, and falls back to account copy", async () => {
  const adapter = new MemorySharingAdapter(initial, 0);
  const pending = deferred<void>();
  const request = vi.spyOn(adapter, "requestAccess").mockImplementationOnce(() => pending.promise);
  const copy = vi.fn();
  const view = render(h(RequestAccess, { url, adapter, caps, onCopyAccountId: copy }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message (optional)" }), {
    target: { value: "Please share" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "What is this for?" }), {
    target: { value: "Planning" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  expect(screen.queryByText("Request sent to the owner")).toBeNull();
  expect(request).toHaveBeenCalledWith(url, {
    role: "viewer",
    message: "Please share",
    purpose: "Planning",
  });
  await act(() => pending.reject(new ShareError("network")));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  await screen.findByText("Request sent to the owner");
  view.rerender(
    h(RequestAccess, {
      url,
      adapter,
      caps: { ...caps, accessRequests: false },
      onCopyAccountId: copy,
    }),
  );
  expect(screen.getByText("Ask the owner to share this with you")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy my Account ID" }));
  await screen.findByText("Account ID copied");
  expect(copy).toHaveBeenCalledOnce();
  await accessible();
});
it("ignores a late grant completion after the resource changes", async () => {
  const adapter = new MemorySharingAdapter(initial, 0);
  const pending = deferred<void>();
  vi.spyOn(adapter, "setPerson").mockImplementationOnce(() => pending.promise);
  const view = render(h(ShareDialog, defaults(adapter)));
  await loaded();
  await selectRawPerson();
  view.rerender(h(ShareDialog, { ...defaults(adapter), url: `${url}-other` }));
  await loaded();
  await act(() => pending.resolve());
  expect(screen.queryByRole("listitem", { name: "https://example.org/sage#me" })).toBeNull();
  expect(adapter.notifications).toHaveLength(0);
});
it("uses a bottom sheet on small screens and recovers a failed initial load", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
  );
  const adapter = new MemorySharingAdapter(initial, 0);
  adapter.failNext("network");
  const load = vi.spyOn(adapter, "load");
  render(h(ShareDialog, defaults(adapter)));
  // Switching from the server's desktop fallback aborts that first load; exactly one live load fails.
  await screen.findByRole("alert");
  expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("sheet-content");
  expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await loaded();
  expect(load.mock.calls.some(([, signal]) => signal.aborted)).toBe(true);
  await accessible();
});
it("ignores a request completion after switching accounts on the same resource", async () => {
  const oldAdapter = new MemorySharingAdapter(initial, 0);
  const pending = deferred<void>();
  vi.spyOn(oldAdapter, "requestAccess").mockImplementationOnce(() => pending.promise);
  const view = render(
    h(RequestAccess, { url, adapter: oldAdapter, caps, onCopyAccountId: vi.fn() }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Request access" }));
  const adapter = new MemorySharingAdapter(initial, 0);
  view.rerender(h(RequestAccess, { url, adapter, caps, onCopyAccountId: vi.fn() }));
  await act(() => pending.resolve());
  expect(screen.queryByText("Request sent to the owner")).toBeNull();
  expect(screen.getByRole("button", { name: "Request access" })).toBeTruthy();
});

it("keeps an existing unsupported general grant visible while preventing role widening", async () => {
  const adapter = new MemorySharingAdapter(
    { ...initial, general: { mode: "link", role: "viewer" } },
    0,
  );
  render(h(ShareDialog, { ...defaults(adapter), caps: { ...caps, publicLinks: false } }));
  await loaded();
  expect(screen.getByText("Anyone with the link can view")).toBeTruthy();
  expect(
    (screen.getByRole("combobox", { name: "General access role" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  // Restriction remains available even when this storage cannot create new public grants.
  expect(
    (screen.getByRole("combobox", { name: "General access" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
