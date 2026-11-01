// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor, within } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const axe = requireUi(
  "axe-core",
) as typeof import("../../../packages/suite-ui/node_modules/axe-core");

import { CapabilityProvider } from "@jeswr/suite-ui/sync";
import { createDemoNotificationSource } from "../src/shell/notifications/demo-source";
import { NotificationsBell } from "../src/shell/notifications/notifications-bell";
import { NotificationsTray } from "../src/shell/notifications/notifications-tray";
import { NotificationSessionProvider } from "../src/shell/notifications/provider";

beforeEach(() => {
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("HTMLSelectElement", window.HTMLSelectElement);
  vi.stubGlobal("HTMLOptionElement", window.HTMLOptionElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(cleanup);
async function accessible() {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}
function tray(expiry = true, failDecision = false) {
  const demo = createDemoNotificationSource();
  let failed = false;
  const decider = {
    async decide(...args: Parameters<typeof demo.decide>) {
      if (failDecision && !failed) {
        failed = true;
        throw new Error("Offline");
      }
      await demo.decide(...args);
    },
  };
  render(
    h(CapabilityProvider, {
      capabilities: { grantExpiry: expiry, liveUpdates: true },
      children: h(NotificationSessionProvider, {
        accountId: "ui-fixture",
        sources: [demo],
        decider,
        liveUpdates: true,
        children: h("main", {
          children: [
            h("h1", { key: "title", children: "Notification fixture" }),
            h(NotificationsBell, { key: "bell", mobile: true }),
            h(NotificationsTray, { key: "tray" }),
          ],
        }),
      }),
    }),
  );
}
it("groups, approves Editor with retry, clears the badge, dismisses all and has no serious axe issues", async () => {
  tray(true, true);
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Notifications, 4 unread" })).toBeTruthy(),
  );
  expect(screen.getByRole("region", { name: "Today" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Earlier" })).toBeTruthy();
  await accessible();
  const request = screen
    .getAllByRole("listitem")
    .find((row) => row.textContent?.includes("Rowan Vale"));
  if (!request) throw new Error("Request row missing");
  const row = within(request);
  fireEvent(
    row.getByRole("combobox", { name: /^Role for / }),
    Object.assign(new MouseEvent("pointerdown", { bubbles: true, button: 0 }), {
      pointerType: "mouse",
    }),
  );
  fireEvent.click(await screen.findByRole("option", { name: "Editor" }));
  fireEvent.click(row.getByRole("radio", { name: "1 day" }));
  fireEvent.click(row.getByRole("button", { name: /^Approve/ }));
  await row.findByRole("alert");
  await accessible();
  fireEvent.click(row.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(row.getByRole("status").textContent).toBe("Approved for Editor"));
  fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
  await screen.findByRole("link", { name: "Notifications, 0 unread" });
  expect(screen.queryByRole("status", { name: /unread$/ })).toBeNull();
  for (const dismiss of screen.getAllByRole("button", { name: /^Dismiss / }))
    fireEvent.click(dismiss);
  await screen.findByText("You're all caught up");
  await accessible();
});
it("explains unsupported expiry, disables duration choices and confirms denial inline", async () => {
  tray(false);
  await screen.findByText("Not available on this storage");
  await accessible();
  for (const radio of screen.getAllByRole("radio"))
    expect((radio as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /^Deny/ }));
  await screen.findByText("Denied", { exact: true });
  expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
});
