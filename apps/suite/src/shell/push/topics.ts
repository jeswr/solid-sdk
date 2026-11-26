// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { createInboxReader } from "@jeswr/pod-access/notify";
import type { PushTopicSpec } from "@jeswr/suite-native/push";
import { ChatClient } from "@/apps/chat/lib/client";
import { encodeRef } from "@/lib/refs";
import type { SuiteAccount } from "../session/types";

/** Only topic URLs go to the relay. Labels and the native chat route alias stay on the phone. */
export async function discoverPushTopics(
  account: SuiteAccount,
  fetch: typeof globalThis.fetch,
): Promise<PushTopicSpec[]> {
  const topics: PushTopicSpec[] = [];
  const inbox = await createInboxReader({ fetch }).inbox(account.webId);
  if (inbox)
    topics.push({
      index: 0,
      kind: "inbox",
      topic: assertWithinPodScope(account.storageUrl, inbox),
      label: "Inbox",
      route: "/notifications",
      enabled: true,
    });
  const rooms = await new ChatClient(fetch, account.storageUrl, account.webId).joinedRooms();
  for (const room of rooms) {
    if ("error" in room) continue;
    const topic = assertWithinPodScope(account.storageUrl, room.url);
    const label =
      room.name
        .trim()
        .replace(/\p{Cc}/gu, "")
        .slice(0, 160) || "Chat";
    topics.push({
      index: topics.length,
      kind: "chat",
      topic,
      label,
      route: `/chat/${encodeRef(topic)}`,
      enabled: true,
    });
  }
  if (topics.length === 0) throw new Error("No notification topics are available for this account");
  if (topics.length > 16)
    throw new Error("Push supports at most sixteen inbox and chat topics per storage");
  return topics;
}
