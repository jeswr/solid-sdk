// AUTHORED-BY Codex GPT-6
import { createInboxReader } from "@jeswr/pod-access/notify";
import { beforeEach, expect, it, vi } from "vitest";
import { encodeRef } from "../src/lib/refs";
import { discoverPushTopics } from "../src/shell/push/topics";
import type { SuiteAccount } from "../src/shell/session/types";

vi.mock("@jeswr/pod-access/notify", () => ({ createInboxReader: vi.fn() }));
const { joinedRooms } = vi.hoisted(() => ({ joinedRooms: vi.fn() }));
vi.mock("../src/apps/chat/lib/client", () => ({
  ChatClient: class {
    joinedRooms = joinedRooms;
  },
}));
const account: SuiteAccount = {
  id: "alice",
  kind: "solid",
  name: "Alice",
  webId: "https://id.example/alice#me",
  storageUrl: "https://pod.example/alice/",
};
const inbox = vi.fn(async (): Promise<string | null> => `${account.storageUrl}inbox/`);
beforeEach(() => {
  inbox.mockResolvedValue(`${account.storageUrl}inbox/`);
  vi.mocked(createInboxReader).mockReturnValue({ inbox, list: vi.fn() });
  joinedRooms.mockResolvedValue([
    { url: `${account.storageUrl}chat/book/`, name: "Book\n club" },
    { url: `${account.storageUrl}chat/missing/`, error: new Error("gone") },
  ]);
});

it("discovers inbox and joined chat containers with private local labels and native route aliases", async () => {
  const topics = await discoverPushTopics(account, fetch);
  expect(topics).toEqual([
    {
      index: 0,
      kind: "inbox",
      label: "Inbox",
      topic: `${account.storageUrl}inbox/`,
      route: "/notifications",
      enabled: true,
    },
    {
      index: 1,
      kind: "chat",
      label: "Book club",
      topic: `${account.storageUrl}chat/book/`,
      route: `/chat/${encodeRef(`${account.storageUrl}chat/book/`)}`,
      enabled: true,
    },
  ]);
});

it("refuses topics outside the selected storage and excessive subscriptions", async () => {
  inbox.mockResolvedValue("https://evil.example/inbox/");
  await expect(discoverPushTopics(account, fetch)).rejects.toThrow();
  inbox.mockResolvedValue(null);
  joinedRooms.mockResolvedValue(
    Array.from({ length: 17 }, (_, index) => ({
      url: `${account.storageUrl}chat/${index}/`,
      name: "Chat",
    })),
  );
  await expect(discoverPushTopics(account, fetch)).rejects.toThrow("sixteen");
  joinedRooms.mockResolvedValue([]);
  await expect(discoverPushTopics(account, fetch)).rejects.toThrow("No notification topics");
});
