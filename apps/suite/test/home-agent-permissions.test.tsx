// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { solidOdrlEngine } from "@jeswr/agent-mandate/verify";
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
import { PermissionsScreen } from "../src/apps/agent/components/permissions";
import * as hooks from "../src/apps/agent/lib/hooks";
import { MEMORY_CATEGORIES } from "../src/apps/agent/lib/mandate-rules";
import * as mandates from "../src/apps/agent/lib/mandates";
import {
  AgentPermissionControls,
  HomeAgentPermissions,
} from "../src/apps/home/components/permissions/home-agent-permissions";

vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => ({}) }));

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

it("names the enabled switch after its rule, explains removal, and returns focus on cancel", async () => {
  const user = userEvent.setup();
  render(<AgentPermissionControls rules />);
  const toggle = screen.getByRole("switch", {
    name: "Ask first: send messages (rule 1)",
    checked: true,
  });
  await user.click(toggle);
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  expect(screen.getByText("The agent won't do this at all.")).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(toggle);
  expect(mandates.activateMandate).not.toHaveBeenCalled();
});
it("removes only the reviewed rule using the verified source as a concurrency guard", async () => {
  const user = userEvent.setup();
  render(<AgentPermissionControls rules />);
  await user.click(screen.getByRole("switch", { name: /Ask first: send messages/ }));
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
it("demotes an automatic rule through the real reduction helper before signing", async () => {
  const user = userEvent.setup();
  const automatic = mandate.withApproval.permissions ?? [];
  mandate = {
    ...mandate,
    autonomous: { ...mandate.autonomous, permissions: automatic },
    withApproval: { ...mandate.withApproval, permissions: [] },
  };
  render(<AgentPermissionControls rules />);
  await user.click(
    screen.getByRole("switch", { name: "Without asking: send messages (rule 1)", checked: true }),
  );
  await screen.findByText("The agent will ask you before doing this");
  await user.click(screen.getByRole("button", { name: "Sign and activate" }));
  await screen.findByText("Your permissions have been saved.");
  expect(mandates.activateMandate).toHaveBeenCalledWith(
    client,
    session,
    expect.objectContaining({
      autonomous: expect.objectContaining({ permissions: [] }),
      withApproval: expect.objectContaining({ permissions: automatic }),
      prohibitions: mandate.prohibitions,
      limits: mandate.limits,
    }),
    expect.any(Date),
    mandate,
  );
});
it("explains when an unsupported rule must be edited and leaves it active", async () => {
  const user = userEvent.setup();
  mandate = {
    ...mandate,
    withApproval: {
      ...mandate.withApproval,
      permissions: [{ type: "permission", action: "urn:unsupported" }],
    },
  };
  render(<AgentPermissionControls rules />);
  const toggle = screen.getByRole("switch", {
    name: "Ask first: other action (rule 1)",
    checked: true,
  });
  await user.click(toggle);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Edit this rule in agent permissions first.",
  );
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect((toggle as HTMLButtonElement).disabled).toBe(false);
  expect(mandates.previewMandate).not.toHaveBeenCalled();
  expect(mandates.activateMandate).not.toHaveBeenCalled();
});
it("disables every switch and announces progress throughout preparation and signing", async () => {
  const user = userEvent.setup();
  const evaluate = solidOdrlEngine.evaluate;
  let finishRemoval!: () => void;
  const removal = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  vi.spyOn(solidOdrlEngine, "evaluate").mockImplementation(async (policy, intent) => {
    if (policy.id === "urn:permission-removal-check") await removal;
    return evaluate(policy, intent);
  });
  let finishPreview!: (value: string) => void;
  vi.mocked(mandates.previewMandate).mockReturnValue(
    new Promise((resolve) => {
      finishPreview = resolve;
    }),
  );
  render(<AgentPermissionControls rules />);
  const toggle = screen.getByRole("switch", { name: /Ask first: send messages/ });
  await user.click(toggle);
  await screen.findByText("Updating your permissions…");
  for (const control of screen.getAllByRole("switch"))
    expect((control as HTMLButtonElement).disabled).toBe(true);
  await user.click(toggle);
  expect(mandates.previewMandate).not.toHaveBeenCalled();
  finishRemoval();
  await waitFor(() => expect(mandates.previewMandate).toHaveBeenCalledTimes(1));
  expect(mandates.previewMandate).toHaveBeenCalledTimes(1);
  finishPreview("Read-only preview");
  const activate = await screen.findByRole("button", { name: "Sign and activate" });
  let finishSave!: () => void;
  vi.mocked(mandates.activateMandate).mockReturnValue(
    new Promise((resolve) => {
      finishSave = () => resolve({} as never);
    }),
  );
  await user.click(activate);
  expect(
    ((await screen.findByRole("button", { name: "Signing…" })) as HTMLButtonElement).disabled,
  ).toBe(true);
  for (const control of screen.getAllByRole("switch", { hidden: true }))
    expect((control as HTMLButtonElement).disabled).toBe(true);
  finishSave();
  await screen.findByText("Your permissions have been saved.");
  expect(
    (screen.getByRole("switch", { name: /Ask first: send messages/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it.each([
  { memoryScope: [] },
  { memoryScope: [MEMORY_CATEGORIES[1].id] },
])("seeds editor memory from current permissions and preserves it through templates: %j", async ({
  memoryScope,
}) => {
  const user = userEvent.setup();
  mandate = { ...mandate, memoryScope };
  const data = {
    mandate,
    agent: mandate.subject,
    accounts: [{ ...exampleRecords.account, channelHandleHash: HASH }],
    emailBindings: ["gmail"],
    sentHashes: [HASH],
  };
  vi.mocked(hooks.useAgentQuery).mockReturnValue({ status: "loading", reload });
  const view = render(<PermissionsScreen />);
  vi.mocked(hooks.useAgentQuery).mockReturnValue({ status: "ready", data, reload });
  view.rerender(<PermissionsScreen />);
  expect((screen.getByRole("checkbox", { name: "Preferences" }) as HTMLInputElement).checked).toBe(
    false,
  );
  expect((screen.getByRole("checkbox", { name: "Health" }) as HTMLInputElement).checked).toBe(
    memoryScope.length > 0,
  );
  for (const template of [
    "Schedule meetings autonomously under £0",
    "Reply to people I've emailed before (ask first)",
    "Tests between my accounts",
  ]) {
    await user.click(screen.getByRole("button", { name: template }));
    expect(
      (screen.getByRole("checkbox", { name: "Preferences" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Health" }) as HTMLInputElement).checked).toBe(
      memoryScope.length > 0,
    );
    await user.click(screen.getByRole("button", { name: "Preview permissions" }));
    await screen.findByRole("heading", { name: "Review your permissions" });
    expect(mandates.previewMandate).toHaveBeenLastCalledWith(
      expect.objectContaining({ memoryScope }),
      client,
    );
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
  }
});

it.each(["workspace", "identity"])("hides Home's agent block without an agent %s", (missing) => {
  vi.spyOn(hooks, "AgentWorkspaceProvider").mockImplementation(({ children, fallback }) =>
    missing === "workspace"
      ? fallback({ status: "error", error: new Error("No workspace"), reload })
      : children,
  );
  vi.mocked(hooks.useAgentQuery).mockReturnValue({ status: "ready", data: undefined, reload });
  const view = render(<HomeAgentPermissions />);
  expect(view.container.textContent).toBe("");
  expect(screen.queryByRole("switch")).toBeNull();
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
