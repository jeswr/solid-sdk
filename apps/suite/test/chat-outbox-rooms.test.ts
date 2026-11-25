// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it, vi } from "vitest";
import { ChatClient, type Message } from "../src/apps/chat/lib/client";
import { buildRoom, roomIndex, saveChat } from "../src/apps/chat/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { box, type result, storageUrl, webId } from "./chat-outbox-helpers";

type Send = Parameters<typeof result>;

/** Real ChatClient sends against a demo pod, in a room of each layout (v1 day documents, v2 members). */
async function fixture(layout: "v1" | "v2") {
  const pod = createDemoPod({ root: storageUrl });
  const client = new ChatClient(pod.fetch, storageUrl, webId);
  let room: string;
  if (layout === "v2") room = (await client.createRoom({ name: "Team", members: [] })).url;
  else {
    room = `${storageUrl}chat/rooms/legacy/`;
    await saveChat(
      pod.fetch,
      storageUrl,
      roomIndex(room),
      buildRoom(room, { name: "Legacy", creator: webId, created: new Date(), members: [] }),
      { ifNoneMatch: "*" },
    );
  }
  return { client, room };
}
const timeline = async (client: ChatClient, room: string) => (await client.messages(room)).messages;

describe.each(["v1", "v2"] as const)("pending sends in a %s room", (layout) => {
  it("acknowledges a delivered message exactly once and notifies once", async () => {
    const { client, room } = await fixture(layout);
    const saved = vi.fn<(message: Message) => void>();
    const { queue, sdk } = box(
      vi.fn((...args: Send) => client.send(...args)),
      () => true,
      webId,
      {
        onSaved: saved,
      },
    );
    await queue.send(room, "Hello");
    const stored = await timeline(client, room);
    expect(stored).toHaveLength(1);
    expect(queue.snapshot().map((row) => [row.id, row.status])).toEqual([
      [stored[0]?.id, undefined],
    ]);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved.mock.calls[0]?.[0]).toMatchObject({ id: stored[0]?.id, content: "Hello" });
    const ids = new Set(stored.map((message) => message.id));
    await queue.acknowledge(ids);
    await queue.acknowledge(ids);
    await queue.flush();
    expect(queue.snapshot()).toEqual([]);
    expect(sdk.pending()).toEqual([]);
    expect(saved).toHaveBeenCalledOnce();
    expect(await timeline(client, room)).toHaveLength(1);
  });

  it("acknowledges a resend that reports a duplicate under the stored ID, and notifies once", async () => {
    const { client, room } = await fixture(layout);
    const saved = vi.fn<(message: Message) => void>();
    let lost = true;
    const { queue, sdk } = box(
      vi.fn(async (...args: Send) => {
        const message = await client.send(...args);
        // The write landed but the response was lost: the row fails, then Retry resends it.
        if (lost) {
          lost = false;
          throw new TypeError("network error");
        }
        return message;
      }),
      () => true,
      webId,
      { onSaved: saved },
    );
    await queue.send(room, "Lost response");
    const [failed] = queue.snapshot();
    expect(failed?.status).toBe("failed");
    expect(saved).not.toHaveBeenCalled();
    await queue.retry(failed?.id as string);
    const stored = await timeline(client, room);
    expect(stored).toHaveLength(1);
    expect(queue.snapshot().map((row) => [row.id, row.status])).toEqual([
      [stored[0]?.id, undefined],
    ]);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved.mock.calls[0]?.[0].id).toBe(stored[0]?.id);
    await queue.acknowledge(new Set(stored.map((message) => message.id)));
    await queue.flush();
    expect(queue.snapshot()).toEqual([]);
    expect(sdk.pending()).toEqual([]);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("acknowledges an in-memory duplicate the same way", async () => {
    const { client, room } = await fixture(layout);
    const saved = vi.fn<(message: Message) => void>();
    const { queue } = box(
      vi.fn(async (...args: Send) => client.send(...args)),
      () => true,
      webId,
      {
        onSaved: saved,
        open: () => {
          throw new Error("No IndexedDB");
        },
      },
    );
    const at = new Date();
    await client.send(room, "Earlier", { id: "fixed", at });
    // Same intent ID and time as the earlier write: the model reports a duplicate.
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
      "fixed" as ReturnType<typeof crypto.randomUUID>,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
    try {
      await queue.send(room, "Earlier");
    } finally {
      vi.useRealTimers();
    }
    const stored = await timeline(client, room);
    expect(stored).toHaveLength(1);
    expect(queue.snapshot().map((row) => [row.id, row.status])).toEqual([
      [stored[0]?.id, undefined],
    ]);
    await queue.acknowledge(new Set(stored.map((message) => message.id)));
    expect(queue.snapshot()).toEqual([]);
    expect(saved).toHaveBeenCalledOnce();
  });
});
