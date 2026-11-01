// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { classifyChatError, PreferencesStore } from "../src/apps/chat/lib/client";
import { ChatIoError } from "../src/apps/chat/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
const ROOM = `${ROOT}chat/rooms/one/`;
it("uses create/update preconditions and rejects stale preference writes", async () => {
  const pod = createDemoPod({ root: ROOT });
  const store = new PreferencesStore(pod.fetch, ROOT);
  expect(await store.read()).toEqual({ data: [], etag: null });
  await store.write([{ roomId: ROOM, lastRead: null }], null);
  const first = await store.read();
  await expect(store.write([], null)).rejects.toMatchObject({ status: 412 });
  await store.write([{ roomId: ROOM, lastRead: 10 }], first.etag);
  await expect(store.write([], first.etag)).rejects.toBeInstanceOf(ChatIoError);
  await expect(store.write([], 'W/"weak"')).rejects.toMatchObject({ code: "missing-etag" });
});
it("merges a winning concurrent marker and retries one preference conflict only", async () => {
  const pod = createDemoPod({ root: ROOT });
  const primary = new PreferencesStore(pod.fetch, ROOT);
  let raced = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.method === "PUT" && !raced) {
      raced = true;
      await primary.markRead(ROOM, new Date(50));
    }
    return pod.fetch(input, init);
  };
  const store = new PreferencesStore(fetch, ROOT);
  expect(await store.markRead(ROOM, new Date(10))).toEqual([{ roomId: ROOM, lastRead: 50 }]);
  const fail = vi.fn<typeof globalThis.fetch>(async (input, init) =>
    init?.method === "PUT" ? new Response(null, { status: 412 }) : pod.fetch(input, init),
  );
  await expect(new PreferencesStore(fail, ROOT).markRead(ROOM, new Date(60))).rejects.toMatchObject(
    { status: 412 },
  );
  expect(fail.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2);
});
it("validates JSON and validators and propagates read and nonconflict write failures", async () => {
  const response = (body: string, etag?: string) =>
    new Response(body, {
      headers: { "content-type": "application/json", ...(etag ? { etag } : {}) },
    });
  for (const body of [
    "{}",
    '{"chat.lastRead":[{"roomId":"javascript:alert(1)","lastRead":null}]}',
    '{"chat.lastRead":[{"roomId":"https://example.org/","lastRead":"bad"}]}',
    "bad JSON",
  ]) {
    await expect(
      new PreferencesStore(async () => response(body, '"one"'), ROOT).read(),
    ).rejects.toThrow();
  }
  await expect(
    new PreferencesStore(async () => response('{"chat.lastRead":[]}'), ROOT).read(),
  ).rejects.toMatchObject({ code: "missing-etag" });
  await expect(
    new PreferencesStore(async () => new Response(null, { status: 403 }), ROOT).read(),
  ).rejects.toMatchObject({ status: 403 });
  const fetch: typeof globalThis.fetch = async (_input, init) =>
    new Response(null, { status: init?.method === "PUT" ? 503 : 404 });
  await expect(new PreferencesStore(fetch, ROOT).markRead(ROOM, new Date(1))).rejects.toMatchObject(
    { status: 503 },
  );
  await expect(
    new PreferencesStore(fetch, ROOT).write([{ roomId: "bad", lastRead: null }], null),
  ).rejects.toThrow();
});

it("classifies transport errors once for the shared async surfaces without exposing raw messages", () => {
  for (const [status, category] of [
    [401, "reauth"],
    [403, "forbidden"],
    [404, "not-found"],
    [410, "not-found"],
    [412, "conflict"],
    [507, "quota"],
    [413, "too-large"],
    [429, "unreachable"],
    [503, "unreachable"],
    [400, "unknown"],
  ] as const)
    expect(classifyChatError({ status })).toBe(category);
  expect(classifyChatError(new TypeError("network"))).toBe("unreachable");
  for (const error of [null, undefined, "unknown", {}, new SyntaxError("JSON"), { status: "503" }])
    expect(classifyChatError(error)).toBe("unknown");
});
