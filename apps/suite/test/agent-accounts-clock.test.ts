// AUTHORED-BY Codex GPT-6
import type { Mandate } from "@jeswr/agent-mandate";
import { defaultMandate } from "@jeswr/agent-mandate/issue";
import { AGENT } from "@jeswr/agent-mandate/verify";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, expect, it, vi } from "vitest";
import { AccountsScreen } from "../src/apps/agent/components/accounts";
import * as device from "../src/apps/agent/components/approval-key-setup-sheet";
import { createAgentClient } from "../src/apps/agent/lib/client";
import * as hooks from "../src/apps/agent/lib/hooks";
import { act, h, mount } from "./drive-ui-dom";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it.each([
  "mandate",
  "allowance",
] as const)("disables the account Send switch at the exact %s expiry", async (kind) => {
  vi.useFakeTimers();
  const start = Date.parse("2026-11-01T12:00:00Z");
  vi.setSystemTime(start);
  const boundary = start + 6200;
  const account = { ...exampleRecords.account, provider: "gmail", label: "My email" };
  const base = defaultMandate({
    id: "urn:mandate",
    ownerWebId: "https://owner.example/#me",
    agentWebId: "https://agent.example/#me",
    recipientHashes: [`sha256:${"a".repeat(64)}`],
    now: new Date(start),
  });
  const mandate: Mandate = {
    ...base,
    ...(kind === "mandate" ? { validUntil: new Date(boundary).toISOString() } : {}),
    autonomous: {
      id: "urn:auto",
      permissions: [
        {
          type: "permission",
          action: `${AGENT}SendMessage`,
          ...(kind === "allowance"
            ? {
                constraints: [
                  {
                    leftOperand: "dateTime",
                    operator: "lt",
                    rightOperand: new Date(boundary).toISOString(),
                  },
                ],
              }
            : {}),
        },
      ],
    },
  };
  const session = {
    webId: base.issuer,
    fetch: vi.fn(),
    storageUrl: "https://pod.example/",
    subscribe: vi.fn(),
    mode: "demo" as const,
    displayName: "Owner",
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
  const accountRows = [{ record: account, url: account.id, etag: null, verified: "unchecked" }];
  const data = [accountRows, [], mandate];
  let calls = 0;
  vi.spyOn(hooks, "useAgentQuery").mockImplementation(() => ({
    status: "ready",
    data: data[calls++ % 3],
    reload: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  const view = await mount(h(AccountsScreen));
  const send = () => view.host.querySelector<HTMLButtonElement>('[aria-label="Send for My email"]');
  expect(send()?.disabled).toBe(false);
  await act(() => vi.advanceTimersByTime(5000));
  expect(send()?.disabled).toBe(false);
  await act(() => vi.advanceTimersByTime(1199));
  expect(send()?.disabled).toBe(false);
  await act(() => vi.advanceTimersByTime(1));
  expect(send()?.disabled).toBe(true);
  await view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
