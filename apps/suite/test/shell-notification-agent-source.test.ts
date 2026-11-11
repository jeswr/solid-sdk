// AUTHORED-BY Codex GPT-6.1-Sol
import { exampleRecords } from "@jeswr/agent-model/testing";
import { beforeEach, expect, it, vi } from "vitest";
import { collection } from "../src/apps/agent/lib/collections";
import { createAgentNotificationSource } from "../src/shell/notifications/agent-source";
import type { SuiteAccount } from "../src/shell/session/types";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  client: vi.fn(),
  audit: vi.fn(),
  proposals: vi.fn(),
  approvals: vi.fn(),
  outbox: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../src/apps/agent/lib/paths", async (original) => ({
  ...(await original<typeof import("../src/apps/agent/lib/paths")>()),
  discoverWorkspace: mocks.discover,
}));
vi.mock("../src/apps/agent/lib/client", async (original) => ({
  ...(await original<typeof import("../src/apps/agent/lib/client")>()),
  createAgentClient: mocks.client,
}));
vi.mock("../src/apps/agent/lib/readers", async (original) => ({
  ...(await original<typeof import("../src/apps/agent/lib/readers")>()),
  readAudit: mocks.audit,
  readProposals: mocks.proposals,
  readApprovals: mocks.approvals,
  readOutbox: mocks.outbox,
}));
vi.mock("../src/apps/agent/lib/verify", () => ({ createAgentVerifier: mocks.verify }));

import { AgentReadError } from "../src/apps/agent/lib/client";

const account: SuiteAccount = {
  id: "agent-source",
  webId: "https://pod.example/profile#me",
  storageUrl: "https://pod.example/",
  name: "Owner",
  kind: "solid",
};
const loaded = <T>(record: T) => ({
  record,
  url: "https://pod.example/record",
  etag: null,
  verified: "unchecked" as const,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.discover.mockResolvedValue("https://pod.example/agent/");
  mocks.client.mockReturnValue({});
  mocks.audit.mockResolvedValue([]);
  mocks.proposals.mockResolvedValue(collection([]));
  mocks.approvals.mockResolvedValue(collection([]));
  mocks.outbox.mockResolvedValue(collection([]));
});
it("projects sent activity and pending approvals using the agent's verified queue", async () => {
  const proposal = {
    ...exampleRecords["action-proposal"],
    id: "https://pod.example/agent/proposals/reply.ttl",
    createdAt: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 60000).toISOString(),
  };
  mocks.proposals.mockResolvedValue(collection([loaded(proposal)]));
  mocks.audit.mockResolvedValue([
    loaded({
      at: proposal.createdAt,
      hash: "sent",
      record: { type: "transmission", status: "sent", proposal: proposal.id },
    }),
    loaded({
      at: proposal.createdAt,
      hash: "refused",
      record: { type: "transmission", status: "refused" },
    }),
  ]);
  const source = createAgentNotificationSource(account, vi.fn());
  expect(source.id).toBe("agent:agent-source");
  const items = await source.list(new AbortController().signal);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    category: "agent-action",
    target: { id: proposal.id, title: "Agent activity" },
    href: "/agent/activity",
  });
  expect(items[1]).toMatchObject({
    category: "agent-approval",
    blocking: true,
    href: "/agent/approvals/reply",
  });
  expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({ webId: account.webId }));
});
it("ignores absent workspaces but surfaces transport and permission errors", async () => {
  const source = createAgentNotificationSource(account, vi.fn());
  mocks.audit.mockRejectedValueOnce(new AgentReadError(404));
  expect(await source.list(new AbortController().signal)).toEqual([]);
  mocks.audit.mockRejectedValueOnce(new AgentReadError(403));
  await expect(source.list(new AbortController().signal)).rejects.toThrow("403");
  mocks.discover.mockRejectedValueOnce(new Error("offline"));
  await expect(source.list(new AbortController().signal)).rejects.toThrow("offline");
});
it("passes the listing signal through fetch and fences ignored cancellation", async () => {
  const fetch = vi.fn(async () => new Response());
  const abort = new AbortController();
  mocks.discover.mockImplementationOnce(async (fetch) => {
    await fetch(account.webId);
    return `${account.storageUrl}agent/`;
  });
  await createAgentNotificationSource(account, fetch).list(abort.signal);
  expect(fetch).toHaveBeenCalledWith(account.webId, { signal: abort.signal });
  mocks.audit.mockImplementationOnce(async () => {
    abort.abort();
    return [];
  });
  await expect(createAgentNotificationSource(account, fetch).list(abort.signal)).rejects.toThrow();
  mocks.discover.mockImplementationOnce(async (fetch) => {
    await fetch(account.webId);
    return `${account.storageUrl}agent/`;
  });
  await expect(createAgentNotificationSource(account, fetch).list(abort.signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});
