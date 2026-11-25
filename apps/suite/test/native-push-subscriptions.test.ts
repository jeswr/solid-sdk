// AUTHORED-BY Codex GPT-6
import { createWebhookSubscriptions } from "@jeswr/pod-notifications";
import type { PushSubscriptionRequest } from "@jeswr/suite-native/push";
import { expect, it, vi } from "vitest";
import { createPushSubscriptions } from "../src/shell/push/subscriptions";

vi.mock("@jeswr/pod-notifications", () => ({ createWebhookSubscriptions: vi.fn() }));

it("selects the account fetch and joins channel metadata with the selected app topics", async () => {
  const transport = vi.fn<typeof fetch>();
  const fetchFor = vi.fn(() => transport);
  const bound = {
    topic: "https://pod.example/inbox/",
    channel: "https://pod.example/channels/one",
    expiresAt: 500,
  };
  const subscribe = vi.fn(async () => [bound]);
  const remove = vi.fn(async () => {});
  vi.mocked(createWebhookSubscriptions).mockReturnValue({ subscribe, remove });
  const clock = () => 100;
  const adapter = createPushSubscriptions(fetchFor, clock);
  const request: PushSubscriptionRequest = {
    accountId: "alice",
    webId: "https://id.example/alice#me",
    storage: "https://pod.example/",
    protocol: "solid",
    inbox: "https://relay.example/inbox/id/secret",
    requestedExpiresAt: 600,
    topics: [
      {
        index: 3,
        kind: "inbox",
        topic: bound.topic,
        label: "Inbox",
        route: "/notifications",
        enabled: true,
      },
    ],
    signal: new AbortController().signal,
  };
  const topics = await adapter.subscribe(request);
  expect(fetchFor).toHaveBeenCalledExactlyOnceWith("alice");
  expect(createWebhookSubscriptions).toHaveBeenCalledWith(transport, clock);
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ topics: [bound.topic] }));
  expect(topics).toEqual([{ ...bound, index: 3, kind: "inbox" }]);
  await adapter.remove({
    accountId: "alice",
    protocol: "solid",
    storage: request.storage,
    topics,
    signal: request.signal,
  });
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({ topics }));
  fetchFor.mockClear();
  await adapter.remove({
    accountId: "signed-out",
    protocol: "solid",
    storage: request.storage,
    topics: [{ ...topics[0]!, expiresAt: 99 }],
    signal: request.signal,
  });
  expect(fetchFor).not.toHaveBeenCalled();
});
