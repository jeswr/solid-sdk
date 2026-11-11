// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import userEvent from "../../../packages/suite-ui/node_modules/@testing-library/user-event";
import * as device from "../src/apps/agent/components/approval-key-setup-sheet";
import * as hooks from "../src/apps/agent/lib/hooks";
import { MEMORY_CATEGORIES } from "../src/apps/agent/lib/mandate-rules";
import * as mandates from "../src/apps/agent/lib/mandates";
import { AgentPermissionControls } from "../src/apps/home/components/permissions/home-agent-permissions";

const HASH = `sha256:${"a".repeat(64)}`;
const current = () =>
  defaultMandate({
    id: "https://pod.test/agent/mandates/old.trig",
    ownerWebId: "https://pod.test/profile#me",
    agentWebId: "https://pod.test/agent#it",
    recipientHashes: [HASH],
    now: new Date(),
  });
let mandate = current();
const reload = vi.fn();
const client = {
  workspace: "https://pod.test/agent/",
  paths: { mandates: "https://pod.test/agent/mandates/" },
};
const session = { webId: mandate.issuer };
beforeEach(() => {
  mandate = current();
  vi.spyOn(hooks, "useAgentWorkspace").mockReturnValue({ client, session } as never);
  vi.spyOn(hooks, "useAgentQuery").mockImplementation(
    () =>
      ({
        status: "ready",
        data: {
          mandate,
          accounts: [
            { ...exampleRecords.account, channelHandleHash: HASH, label: "Personal email" },
          ],
        },
        reload,
      }) as never,
  );
  vi.spyOn(device, "useApprovalDevice").mockReturnValue({
    status: "ready",
    setup: vi.fn(),
    requireKey: async (action) => action(),
  });
  vi.spyOn(mandates, "previewMandate").mockResolvedValue("Read-only preview");
  vi.spyOn(mandates, "activateMandate").mockResolvedValue({} as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("previews removing a rule, explains the consequence, and returns focus on cancel", async () => {
  const user = userEvent.setup();
  render(<AgentPermissionControls rules />);
  const toggle = screen.getByRole("switch", { name: /Remove permission ask first: send messages/ });
  await user.click(toggle);
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  expect(screen.getByText("The agent will ask you before doing this")).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(toggle);
  expect(mandates.activateMandate).not.toHaveBeenCalled();
});
it("removes only the reviewed rule using the verified source as a concurrency guard", async () => {
  const user = userEvent.setup();
  render(<AgentPermissionControls rules />);
  await user.click(screen.getByRole("switch", { name: /Remove permission/ }));
  await user.click(await screen.findByRole("button", { name: "Sign and activate" }));
  await screen.findByText("Your permissions have been saved.");
  expect(mandates.activateMandate).toHaveBeenCalledWith(
    client,
    session,
    expect.objectContaining({
      withApproval: expect.objectContaining({ permissions: [] }),
      prohibitions: mandate.prohibitions,
      limits: mandate.limits,
      validUntil: mandate.validUntil,
    }),
    expect.any(Date),
    mandate,
  );
  expect(reload).toHaveBeenCalled();
});
it("Personalise OFF signs an empty memory scope; ON names preferences in the review", async () => {
  const user = userEvent.setup();
  const view = render(<AgentPermissionControls />);
  expect(screen.getByText("Preferences")).toBeTruthy();
  await user.click(screen.getByRole("switch", { name: "Personalise" }));
  await user.click(await screen.findByRole("button", { name: "Sign and activate" }));
  await screen.findByText("Your permissions have been saved.");
  expect(mandates.activateMandate).toHaveBeenCalledWith(
    client,
    session,
    expect.objectContaining({ memoryScope: [] }),
    expect.any(Date),
    mandate,
  );
  view.unmount();
  mandate = { ...mandate, memoryScope: [] };
  render(<AgentPermissionControls />);
  expect(screen.getByRole("switch", { name: "Personalise" }).getAttribute("aria-checked")).toBe(
    "false",
  );
  await user.click(screen.getByRole("switch", { name: "Personalise" }));
  await screen.findByText("Your agent will use your saved preferences to personalise.");
  await user.click(screen.getByRole("button", { name: "Sign and activate" }));
  await waitFor(() =>
    expect(mandates.activateMandate).toHaveBeenCalledWith(
      client,
      session,
      expect.objectContaining({ memoryScope: [MEMORY_CATEGORIES[0].id] }),
      expect.any(Date),
      mandate,
    ),
  );
});
it("keeps signed state unchanged after failure and offers a pending revocation retry", async () => {
  const user = userEvent.setup();
  const retry = vi.fn().mockResolvedValue(undefined);
  vi.mocked(mandates.activateMandate).mockRejectedValue(
    new mandates.PendingRevocation(
      "New permissions are active; old permissions need to stop.",
      retry,
    ),
  );
  render(<AgentPermissionControls />);
  await user.click(screen.getByRole("switch", { name: "Personalise" }));
  await user.click(await screen.findByRole("button", { name: "Sign and activate" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Your permissions have been saved.")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Your permissions have been saved.");
  expect(retry).toHaveBeenCalledTimes(1);
  expect(mandates.activateMandate).toHaveBeenCalledTimes(1);
});
it("filters the agent app row and disables personalisation when no verified permissions exist", () => {
  const view = render(<AgentPermissionControls rules search="unrelated" />);
  expect(screen.queryByRole("heading", { name: "Your agent" })).toBeNull();
  view.unmount();
  vi.mocked(hooks.useAgentQuery).mockReturnValue({
    status: "ready",
    data: { mandate: undefined, accounts: [] },
    reload,
  });
  render(<AgentPermissionControls rules />);
  expect((screen.getByRole("switch", { name: "Personalise" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText("No verified permissions are active.")).toBeTruthy();
});
