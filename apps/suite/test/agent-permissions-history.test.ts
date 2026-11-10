// AUTHORED-BY Codex GPT-6
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { afterEach, expect, it, vi } from "vitest";
import * as device from "../src/apps/agent/components/approval-key-setup-sheet";
import { PermissionsScreen } from "../src/apps/agent/components/permissions";
import { createAgentClient } from "../src/apps/agent/lib/client";
import * as hooks from "../src/apps/agent/lib/hooks";
import { h, mount } from "./drive-ui-dom";

afterEach(() => vi.restoreAllMocks());
it("keeps current permissions and the Stop control usable when history cannot load", async () => {
  const mandate = defaultMandate({
    id: "urn:mandate",
    ownerWebId: "https://owner.example/#me",
    agentWebId: "https://agent.example/#me",
    recipientHashes: [`sha256:${"a".repeat(64)}`],
    now: new Date(),
  });
  const session = {
    mode: "demo" as const,
    displayName: "Owner",
    webId: mandate.issuer,
    fetch: vi.fn(),
    storageUrl: "https://pod.example/",
    subscribe: vi.fn(),
    reset: vi.fn(),
  };
  const client = createAgentClient({
    fetch: session.fetch,
    storage: session.storageUrl,
    workspace: `${session.storageUrl}agent/`,
  });
  vi.spyOn(hooks, "useAgentWorkspace").mockReturnValue({ client, session });
  vi.spyOn(device, "useApprovalDevice").mockReturnValue({
    status: "checking",
    setup: vi.fn(),
    requireKey: vi.fn(),
  });
  const data = { mandate, accounts: [], agent: mandate.subject, emailBindings: [], sentHashes: [] };
  vi.spyOn(hooks, "useAgentQuery").mockImplementation((key) =>
    key === client.paths.mandates
      ? { status: "error", error: new Error("Unreadable history"), reload: vi.fn() }
      : { status: "ready", data, reload: vi.fn() },
  );
  const view = await mount(h(PermissionsScreen));
  const stop = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Stop using these permissions",
  );
  expect(stop?.disabled).toBe(false);
  expect(view.host.textContent).toContain("Give your agent permissions");
  expect(view.host.textContent).not.toContain("Couldn't read your permissions");
  await view.unmount();
});
