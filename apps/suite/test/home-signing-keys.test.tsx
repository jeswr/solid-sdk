// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import userEvent from "../../../packages/suite-ui/node_modules/@testing-library/user-event";

const OLD = "https://pod.test/profile/card#agent-approval-20261001-0123abcd";
const DEVICE = "https://pod.test/profile/card#agent-approval-20261101-89abcdef";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  impact: vi.fn(),
  revoke: vi.fn(),
  workspace: { client: { id: "client" }, session: { webId: "https://pod.test/profile/card#me" } },
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => ({}) }));
vi.mock("../src/apps/agent/lib/hooks", () => ({
  AgentWorkspaceProvider: ({ children }: { children: ReactNode }) => children,
  useAgentWorkspace: () => mocks.workspace,
}));
vi.mock("../src/apps/agent/lib/key-admin", () => ({
  listApprovalKeys: mocks.list,
  revocationImpact: mocks.impact,
  revokeApprovalKey: mocks.revoke,
}));

import { SigningKeys } from "../src/apps/home/components/permissions/signing-keys";

const rows = [
  { id: DEVICE, created: "2026-11-01", thisDevice: true },
  { id: OLD, created: "2026-10-01", thisDevice: false },
];
beforeEach(() => {
  mocks.list.mockResolvedValue(rows);
  mocks.impact.mockResolvedValue({ statements: 2, lapsing: 1, permissions: true });
  mocks.revoke.mockResolvedValue({ resigned: 2 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows creation dates and device labels only, under an h3", async () => {
  render(<SigningKeys />);
  expect(await screen.findByText("This device")).toBeTruthy();
  expect(screen.getByText("Another device")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 3, name: "Signing keys" })).toBeTruthy();
  // This device's own key has no Revoke button.
  expect(screen.getAllByRole("button", { name: /^Revoke key/ })).toHaveLength(1);
  expect(document.body.textContent).not.toContain("0123abcd");
});

it("explains the impact and returns focus to Revoke when the dialog closes", async () => {
  const user = userEvent.setup();
  render(<SigningKeys />);
  const trigger = await screen.findByRole("button", { name: /^Revoke key/ });
  await user.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  await waitFor(() => expect(dialog.textContent).toContain("signs 2 of your agent's"));
  expect(dialog.textContent).toContain("1 instruction that allowed");
  expect(dialog.textContent).toContain("stop until you grant them again");
  expect(mocks.impact).toHaveBeenCalledWith(mocks.workspace.client, mocks.workspace.session, OLD);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("revokes, then moves focus to the heading because the row is gone", async () => {
  const user = userEvent.setup();
  render(<SigningKeys />);
  await user.click(await screen.findByRole("button", { name: /^Revoke key/ }));
  const confirm = await screen.findByRole("button", { name: "Revoke" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  mocks.list.mockResolvedValue([rows[0]]);
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mocks.revoke).toHaveBeenCalledWith(mocks.workspace.client, mocks.workspace.session, OLD);
  await waitFor(() => expect(screen.queryByText("Another device")).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3 }));
});

it("keeps the dialog open and the key listed when revocation fails", async () => {
  const user = userEvent.setup();
  mocks.revoke.mockRejectedValue(new Error("Couldn't re-sign your agent's controls"));
  render(<SigningKeys />);
  await user.click(await screen.findByRole("button", { name: /^Revoke key/ }));
  const confirm = await screen.findByRole("button", { name: "Revoke" });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  await user.click(confirm);
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalled());
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(screen.getByText("Another device")).toBeTruthy();
});

it("blocks Revoke when the impact check fails, and hides it without a device key", async () => {
  const user = userEvent.setup();
  mocks.impact.mockRejectedValue(new Error("Your profile is outside the storage you shared"));
  const view = render(<SigningKeys />);
  await user.click(await screen.findByRole("button", { name: /^Revoke key/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("outside the storage");
  expect((screen.getByRole("button", { name: "Revoke" }) as HTMLButtonElement).disabled).toBe(true);
  view.unmount();
  mocks.list.mockResolvedValue([{ ...rows[1] }]);
  render(<SigningKeys />);
  expect(await screen.findByText(/first set up this device/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Revoke key/ })).toBeNull();
});
