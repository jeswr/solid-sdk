// AUTHORED-BY Codex GPT-6.1-Sol
import type { OlmMachine } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { json, record } from "./shared.js";

export interface MatrixCrypto {
  /** Apply the complete crypto portion of /sync BEFORE decrypting its timeline. */
  receiveSync(sync: Record<string, unknown>): Promise<void>;
  decrypt(event: Record<string, unknown>, roomId: string): Promise<Record<string, unknown>>;
}
/** No network I/O or key uploads. Host owns the provisioned device's persistent machine. */
export async function createMatrixCrypto(
  machine: Pick<OlmMachine, "receiveSyncChanges" | "decryptRoomEvent">,
): Promise<MatrixCrypto> {
  const { DeviceLists, RoomId, UserId } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
  return {
    async receiveSync(sync) {
      const lists = record(sync.device_lists ?? {});
      await machine.receiveSyncChanges(
        JSON.stringify(record(sync.to_device ?? {}).events ?? []),
        new DeviceLists(
          (lists.changed as string[] | undefined)?.map((id) => new UserId(id)),
          (lists.left as string[] | undefined)?.map((id) => new UserId(id)),
        ),
        record(sync.device_one_time_keys_count ?? {}) as Record<string, number>,
        (sync.device_unused_fallback_key_types ?? []) as string[],
      );
    },
    async decrypt(event, roomId) {
      return json(
        (await machine.decryptRoomEvent(JSON.stringify(event), new RoomId(roomId))).event,
        65536,
      );
    },
  };
}
