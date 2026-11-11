// AUTHORED-BY Codex GPT-6.1-Sol
import type { Account, ChannelCapability } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { afterEach, expect, it, vi } from "vitest";
import { AccountsScreen } from "../src/apps/agent/components/accounts";
import * as device from "../src/apps/agent/components/approval-key-setup-sheet";
import { createAgentClient } from "../src/apps/agent/lib/client";
import * as hooks from "../src/apps/agent/lib/hooks";
import { h, mount } from "./drive-ui-dom";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => vi.restoreAllMocks());

const account: Account = {
  ...exampleRecords.account,
  provider: "google",
  id: "https://pod.example/agent/accounts/mail.ttl",
  label: "Personal mail",
  inventory: {
    channelHandles: ["salted-one", "salted-two"],
    credentialRefs: [],
    setupStatus: "error",
    evidence: [],
    identityConflicts: [{ kind: "identity-mismatch", handleHashes: ["salted-one", "salted-two"] }],
  },
};
const descriptor: ChannelCapability = {
  ...exampleRecords["channel-capability"],
  binding: "gmail",
  account: account.id,
  grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "Mail.Read"],
};
async function screen(accounts = [account], descriptors = [descriptor], id?: string) {
  const session = {
    webId: "https://owner.example/#me",
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
  const data = [
    accounts.map((record) => ({ record, url: record.id })),
    descriptors.map((record) => ({ record, url: record.id })),
    undefined,
  ];
  let calls = 0;
  vi.spyOn(hooks, "useAgentQuery").mockImplementation(() => ({
    status: "ready",
    data: data[calls++ % 3],
    reload: vi.fn(),
  }));
  vi.stubGlobal("matchMedia", window.matchMedia);
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  return mount(h(AccountsScreen, id ? { id } : {}));
}

it("groups cards by channel, renders local provider logos, state labels and safe conflict guidance", async () => {
  const accounts = (["none", "setup-required", "connected", "error", "disabled"] as const).map(
    (bindingState, i) => ({
      ...account,
      id: `${account.id}-${i}`,
      bindingState,
      ...(i === 4 ? { channel: "matrix", provider: "matrix" } : {}),
    }),
  );
  const view = await screen(accounts);
  expect([...view.host.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
    "Email",
    "Matrix",
  ]);
  expect(view.host.querySelectorAll("[data-agent-account]")).toHaveLength(5);
  expect([...view.host.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
    ...Array(4).fill("/agent/providers/google.svg"),
    "/agent/providers/matrix.svg",
  ]);
  for (const label of [
    "Personal mail",
    "Example",
    "Not set up",
    "Setup required",
    "Connected",
    "Error",
    "Disabled",
    "Two different handles recorded — pick one",
    "Only you can make this choice.",
  ])
    expect(view.host.textContent).toContain(label);
  expect(view.host.querySelectorAll('[role="switch"][aria-checked="false"]')).toHaveLength(20);
  expect(view.host.querySelectorAll('[role="switch"][disabled]')).toHaveLength(5);
  expect(view.host.textContent).toContain("Last ingest: Not recorded");
  expect(account.inventory?.identityConflicts).toHaveLength(1);
  await view.unmount();
});

it("renders only this account's granted scopes and plain-language capabilities", async () => {
  const view = await screen(
    [account],
    [
      {
        ...descriptor,
        id: `${descriptor.id}-other`,
        account: `${account.id}-other`,
        grantedScopes: ["other-account-scope"],
      },
      descriptor,
    ],
    "mail",
  );
  expect([...view.host.querySelectorAll(".agent-scopes li")].map((li) => li.textContent)).toEqual(
    descriptor.grantedScopes,
  );
  expect(view.host.textContent).not.toContain("other-account-scope");
  const scopeDetails = view.host.querySelector(".agent-scopes")?.closest("details");
  expect(scopeDetails?.open).toBe(false);
  expect(scopeDetails?.querySelector("summary")?.textContent).toBe("Technical details");
  expect(view.host.querySelector("table")?.textContent).toContain("Can carry structured dataYes");
  expect(view.host.querySelector("table")?.textContent).toContain("End-to-end encryptedNo");
  expect(view.host.textContent).not.toContain("Last ingest: Not recorded");
  await view.unmount();
});

it("distinguishes no granted scopes from scopes the daemon has not recorded", async () => {
  const empty = await screen([account], [{ ...descriptor, grantedScopes: [] }], "mail");
  expect(empty.host.textContent).toContain("No scopes granted.");
  await empty.unmount();
  const missing = await screen([account], [], "mail");
  expect(missing.host.textContent).toContain("No scopes recorded by the agent.");
  expect(missing.host.textContent).toContain("No capabilities recorded for this account.");
  await missing.unmount();
});
