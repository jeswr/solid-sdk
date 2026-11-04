// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { createMatrixCrypto } from "../src/matrix/crypto.js";
import { event, roomId } from "./fixtures/matrix.js";

vi.mock("@matrix-org/matrix-sdk-crypto-nodejs", () => {
  class Id {
    constructor(readonly value: string) {}
  }
  class DeviceLists {
    constructor(
      readonly changed: unknown,
      readonly left: unknown,
    ) {}
  }
  return { UserId: Id, RoomId: Id, DeviceLists };
});
it("feeds complete sync crypto metadata before decrypting through the native SDK interface", async () => {
  const machine = {
    receiveSyncChanges: vi.fn(async () => "[]"),
    decryptRoomEvent: vi.fn(async () => ({ event: JSON.stringify(event()) })),
  };
  const crypto = await createMatrixCrypto(
    machine as unknown as Parameters<typeof createMatrixCrypto>[0],
  );
  await crypto.receiveSync({});
  expect(machine.receiveSyncChanges).toHaveBeenCalledWith(
    "[]",
    { changed: undefined, left: undefined },
    {},
    [],
  );
  await crypto.receiveSync({
    to_device: { events: [{ type: "m.room_key", content: { synthetic: true } }] },
    device_lists: { changed: ["@peer:example.org"], left: ["@left:example.org"] },
    device_one_time_keys_count: { signed_curve25519: 1 },
    device_unused_fallback_key_types: ["signed_curve25519"],
  });
  expect(machine.receiveSyncChanges).toHaveBeenLastCalledWith(
    expect.stringContaining("m.room_key"),
    { changed: [{ value: "@peer:example.org" }], left: [{ value: "@left:example.org" }] },
    { signed_curve25519: 1 },
    ["signed_curve25519"],
  );
  expect(await crypto.decrypt(event(), roomId)).toEqual(event());
  expect(machine.decryptRoomEvent).toHaveBeenCalledWith(JSON.stringify(event()), { value: roomId });
});
it("surfaces crypto failures instead of returning undecrypted or unbounded content", async () => {
  const machine = {
    receiveSyncChanges: vi.fn(async () => "[]"),
    decryptRoomEvent: vi.fn(async () => ({ event: "x".repeat(65537) })),
  };
  const crypto = await createMatrixCrypto(
    machine as unknown as Parameters<typeof createMatrixCrypto>[0],
  );
  await expect(crypto.decrypt(event(), roomId)).rejects.toThrow("JSON");
  machine.receiveSyncChanges.mockRejectedValue(new Error("synthetic SDK failure"));
  await expect(crypto.receiveSync({})).rejects.toThrow("SDK failure");
});
