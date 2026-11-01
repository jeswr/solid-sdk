// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import type { guardedFetch } from "@jeswr/guarded-fetch";

export { createGuardedFetch } from "@jeswr/guarded-fetch";

import { vi } from "vitest";
import { createMatrixReader } from "../../src/matrix.js";
import { RecordingTokenProvider } from "../../src/testing.js";
import { account } from "./signed.js";

export const homeserver = "https://matrix.example";
export const userId = "@owner:example.org";
export const roomId = "!dm:example.org";
export const event = (
  id = "$one",
  content: unknown = { msgtype: "m.text", body: "Hello fixture" },
) => ({
  event_id: id,
  room_id: roomId,
  sender: userId,
  origin_server_ts: 1700000000000,
  type: "m.room.message",
  content,
});
export const sync = (events: unknown[] = [event()], extra: Record<string, unknown> = {}) => ({
  next_batch: "s1",
  rooms: { join: { [roomId]: { timeline: { events, limited: false } } } },
  ...extra,
});
export const direct = { "@peer:example.org": [roomId] };
export function fixtureTransport(replies: unknown[]) {
  const requests: { url: URL; method: string | undefined; headers: Headers; body: string }[] = [];
  const queue = [...replies];
  const transport = vi.fn<typeof guardedFetch>(async (input, init) => {
    requests.push({
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers),
      body: init?.body ? await new Response(init.body).text() : "",
      method: init?.method,
    });
    if (!queue.length) throw new Error("fixture exhausted");
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  return {
    requests,
    queue,
    transport,
    options: {
      createTransport:
        ({ beforeDispatch }: { beforeDispatch?: () => void } = {}) =>
        (input: Parameters<typeof guardedFetch>[0], init?: RequestInit) => {
          beforeDispatch?.();
          return transport(input, init);
        },
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
  };
}
export function reader(replies: unknown[], overrides: Record<string, unknown> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const crypto = {
    receiveSync: vi.fn(async () => {}),
    decrypt: vi.fn(async (value: Record<string, unknown>) => ({
      ...value,
      type: "m.room.message",
      content: { msgtype: "m.text", body: "decrypted fixture" },
    })),
  };
  const config = {
    account,
    homeserver,
    userId,
    tokens,
    crypto,
    transport: fake.options,
    ...overrides,
  };
  return { ...fake, tokens, crypto, config, binding: createMatrixReader(config) };
}
export const cursor = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ account: account.id, homeserver, userId, since: "s0", pending: [], ...extra });

export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("required Matrix fixture missing");
  return value;
}
