// AUTHORED-BY Codex GPT-6.1-Sol
import { type ConnectionRecord, MCP } from "@jeswr/mcp-connections";
import { beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/types";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({ list: vi.fn(), disconnect: vi.fn() }));
vi.mock("../src/shell/settings/assistants/connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shell/settings/assistants/connections")>()),
  listConnections: mocks.list,
  disconnectConnection: mocks.disconnect,
}));

import { ConnectedAssistants } from "../src/shell/settings/assistants/connected";

function session(id = "alice"): PodSession {
  return {
    mode: "solid",
    webId: `https://pod.example/${id}/profile#me`,
    storageUrl: `https://pod.example/${id}/`,
    displayName: id,
    fetch: vi.fn(),
    publicFetch: vi.fn(),
    subscribe: () => () => {},
  };
}
const record: ConnectionRecord = {
  resource: "https://mcp.example/mcp",
  client: "https://mcp.example/clients/opaque",
  title: "Demo assistant",
  redirectOrigin: "https://assistant.example/",
  created: new Date("2026-11-01Z"),
  expiresAt: new Date("2099-12-01Z"),
  access: `${MCP}ReadOnly`,
  personalDataMode: `${MCP}OwnerPolicy`,
  purposes: ["https://w3id.org/dpv#ServiceProvision"],
};
const row = { url: `https://pod.example/alice/private/pkg/clients/${"a".repeat(32)}.ttl`, record };
function button(name: string) {
  const found = [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mocks.list.mockReset().mockResolvedValue({ rows: [row], unreadable: 0, truncated: false });
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
});
it("shows connection identity, policy, unreadable notice and history, with matched audit names", async () => {
  const onNames = vi.fn();
  mocks.list.mockResolvedValue({
    rows: [
      row,
      {
        ...row,
        url: "other",
        record: {
          ...record,
          title: "Former assistant",
          client: "https://assistant.example/app",
          revokedAt: new Date("2026-11-02Z"),
        },
      },
      {
        ...row,
        url: "expired",
        record: {
          ...record,
          title: "Old assistant",
          expiresAt: new Date("2020-01-01Z"),
          personalDataMode: `${MCP}NoPersonalData`,
          access: `${MCP}ReadWrite`,
        },
      },
    ],
    unreadable: 2,
    truncated: true,
  });
  const view = await mount(h(ConnectedAssistants, { session: session(), onNames }));
  expect(view.host.textContent).toContain("Name given by the app");
  expect(view.host.textContent).toContain(record.client);
  expect(view.host.textContent).toContain("Read only");
  expect(view.host.textContent).toContain("Owner policy");
  expect(view.host.textContent).toContain("2 connection records couldn't be read.");
  expect(view.host.textContent).toContain("Showing the first 100 connection records.");
  expect(view.host.textContent).toContain("Previously connected");
  expect(view.host.textContent).toContain("Disconnected on 2026-11-02");
  expect(view.host.textContent).toContain("Expired");
  expect(onNames).toHaveBeenLastCalledWith(
    expect.objectContaining({
      names: expect.objectContaining({ [record.client]: "Demo assistant" }),
    }),
  );
});
it("confirms disconnect in an AlertDialog, retries failures and refreshes after success", async () => {
  const account = session();
  const view = await mount(h(ConnectedAssistants, { session: account }));
  await click(button("Disconnect Demo assistant"));
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Disconnect Demo assistant?",
  );
  expect(document.body.textContent).toContain(
    "It loses access to your pod immediately. You can connect it again later.",
  );
  await click(button("Cancel"));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(mocks.disconnect).not.toHaveBeenCalled();
  await click(button("Disconnect Demo assistant"));
  mocks.disconnect.mockRejectedValueOnce(new Error("secret backend details"));
  await click(button("Disconnect"));
  expect(document.body.textContent).toContain("Couldn't disconnect. Try again.");
  expect(document.body.textContent).not.toContain("backend details");
  mocks.list.mockResolvedValue({
    rows: [{ ...row, record: { ...record, revokedAt: new Date("2026-11-11Z") } }],
    unreadable: 0,
  });
  await click(button("Disconnect"));
  expect(mocks.disconnect).toHaveBeenCalledWith(account, row.url, expect.any(AbortSignal));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(view.host.textContent).toContain("Disconnected on 2026-11-11");
});
it("loads, retries errors, and handles an empty listing", async () => {
  const pending = deferred<never>();
  mocks.list
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ rows: [], unreadable: 0 });
  const view = await mount(h(ConnectedAssistants, { session: session() }));
  expect(view.host.textContent).toContain("Loading connected assistants");
  await act(() => pending.reject(new Error("unavailable")));
  await click(button("Retry"));
  expect(view.host.textContent).toContain("No connected assistants");
});
it("clears account-bound rows and dialog, aborts old writes and ignores late replies", async () => {
  const view = await mount(h(ConnectedAssistants, { session: session() }));
  await click(button("Disconnect Demo assistant"));
  const pending = deferred<void>();
  mocks.disconnect.mockReturnValueOnce(pending.promise);
  await click(button("Disconnect"));
  const signal = mocks.disconnect.mock.calls[0]?.[2] as AbortSignal;
  const oldList = deferred<never>();
  mocks.list.mockReturnValueOnce(oldList.promise);
  await view.render(h(ConnectedAssistants, { session: session("bob") }));
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(view.host.textContent).not.toContain("Demo assistant");
  await act(() => pending.resolve());
  await view.unmount();
  await act(() => oldList.reject(new Error("old account")));
});
it("hides rows and the dialog offline and revalidates on reconnection", async () => {
  const view = await mount(h(ConnectedAssistants, { session: session() }));
  await click(button("Disconnect Demo assistant"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  await act(() => window.dispatchEvent(new Event("offline")));
  expect(view.host.textContent).toContain("Reconnect to manage connected assistants.");
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(mocks.disconnect).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(() => window.dispatchEvent(new Event("online")));
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(view.host.textContent).toContain("Demo assistant");
});
