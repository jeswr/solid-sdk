// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { exampleRecords } from "@jeswr/agent-model/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import userEvent from "../../../packages/suite-ui/node_modules/@testing-library/user-event";

vi.mock("@/shell/app-frame", () => ({ AppHeading: "h1" }));
vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => ({ storageUrl: "https://pod.test/" }),
}));
vi.mock("../src/apps/home/components/permissions/signing-keys", () => ({
  SigningKeys: () => null,
}));
vi.mock("../src/apps/agent/components/approval-key-setup-sheet", () => ({
  ApprovalDeviceProvider: ({ children }: { children: ReactNode }) => children,
  useApprovalDevice: () => ({ status: "ready", requireKey: vi.fn() }),
}));

import * as hooks from "../src/apps/agent/lib/hooks";
import { PermissionsPage } from "../src/apps/home/components/permissions/permissions-page";
import * as permissions from "../src/apps/home/state/permissions";
import * as requests from "../src/apps/home/state/requests";

beforeEach(() => {
  const mandate = defaultMandate({
    id: "urn:permissions",
    ownerWebId: "https://pod.test/profile#me",
    agentWebId: "https://pod.test/agent#it",
    recipientHashes: [`sha256:${"a".repeat(64)}`],
    now: new Date(),
  });
  vi.spyOn(hooks, "AgentWorkspaceProvider").mockImplementation(({ children }) => children);
  vi.spyOn(hooks, "useAgentWorkspace").mockReturnValue({
    client: { workspace: "https://pod.test/agent/", paths: { agentIntroduction: "identity" } },
    session: {},
  } as never);
  vi.spyOn(hooks, "useAgentQuery").mockImplementation(
    (key) =>
      ({
        status: "ready",
        data:
          key === "identity"
            ? mandate.subject
            : { mandate, accounts: [{ ...exampleRecords.account, label: "Personal email" }] },
        reload: vi.fn(),
      }) as never,
  );
  vi.spyOn(permissions, "usePermissions").mockReturnValue({
    status: "ready",
    rows: [],
    failures: [],
    online: true,
    truncated: false,
  } as never);
  vi.spyOn(requests, "useRequestCaps").mockReturnValue({ accessRequests: false } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("only shows filtered-empty when neither app rows nor the agent match", async () => {
  const user = userEvent.setup();
  render(<PermissionsPage />);
  await user.click(screen.getByRole("tab", { name: "Apps" }));
  const search = screen.getByRole("textbox", { name: "Search permissions" });
  for (const term of ["agent", "send messages", "personal email", "preferences"]) {
    await user.clear(search);
    await user.type(search, term);
    await screen.findByRole("region", { name: "Your agent permissions" });
    await waitFor(() => expect(screen.queryByText(/No results/)).toBeNull());
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  }
  await user.clear(search);
  await user.type(search, "unrelated");
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Your agent permissions" })).toBeNull(),
  );
  expect(await screen.findByRole("button", { name: /Clear/ })).toBeTruthy();
  await user.clear(search);
  await user.type(search, "agent");
  await screen.findByRole("region", { name: "Your agent permissions" });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull());
  await user.click(screen.getByRole("tab", { name: "People" }));
  expect(await screen.findByRole("button", { name: /Clear/ })).toBeTruthy();
});
