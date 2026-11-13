// AUTHORED-BY Claude Opus 5.5
// Home's inbox listing: listRequests, then share recognition for its unreadable members only.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), shares: vi.fn() }));
vi.mock("@jeswr/pod-access/requests-solid", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listRequests: mocks.list,
}));
vi.mock("@jeswr/suite-sdk/shared", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  shareNotificationUrls: mocks.shares,
}));

import type { AccessRequestEntry } from "@jeswr/pod-access/requests-solid";
import { listInboxRequests } from "../src/apps/home/lib/requests/listing";

const ROOT = "https://pod.test/";
const fetch = vi.fn<typeof globalThis.fetch>();
const options = { fetch, webId: `${ROOT}profile#me`, storage: ROOT };
const request: AccessRequestEntry = {
  id: `${ROOT}inbox/1.ttl`,
  status: "pending",
  requester: "https://coach.example/card#me",
  dataTypes: ["https://example.org/Activity"],
  modes: ["read"],
  modesByType: { "https://example.org/Activity": ["read"] },
};
const share: AccessRequestEntry = { id: `${ROOT}inbox/share.ttl`, status: "unreadable" };

beforeEach(() => vi.clearAllMocks());

it("reads nothing more when every member is a request", async () => {
  mocks.list.mockResolvedValue([request]);
  expect(await listInboxRequests(options)).toEqual({ entries: [request], shares: new Set() });
  expect(mocks.list).toHaveBeenCalledWith(options);
  expect(mocks.shares).not.toHaveBeenCalled();
});

it("asks the share reader about unreadable members, with the inbox and signal when given", async () => {
  mocks.list.mockResolvedValue([request, share]);
  mocks.shares.mockResolvedValue(new Set([share.id]));
  const signal = new AbortController().signal;
  const inbox = `${ROOT}inbox/`;
  expect(await listInboxRequests({ ...options, inbox, signal })).toEqual({
    entries: [request, share],
    shares: new Set([share.id]),
  });
  expect(mocks.shares).toHaveBeenCalledWith([share.id], {
    fetch,
    webId: options.webId,
    inbox,
    signal,
  });
});

it("keeps every unreadable member counted when share recognition fails, unless aborted", async () => {
  mocks.list.mockResolvedValue([share]);
  mocks.shares.mockRejectedValue(new Error("offline"));
  expect(await listInboxRequests(options)).toEqual({ entries: [share], shares: new Set() });
  const controller = new AbortController();
  mocks.shares.mockImplementation(async () => {
    controller.abort();
    throw controller.signal.reason;
  });
  await expect(listInboxRequests({ ...options, signal: controller.signal })).rejects.toThrow();
});
