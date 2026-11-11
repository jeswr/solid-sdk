// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare builtins
// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { expect, it } from "vitest";
import { createMatrixCrypto } from "../src/matrix/crypto.js";
import { createMatrixReader } from "../src/matrix.js";
import { RecordingTokenProvider } from "../src/testing.js";
import {
  direct,
  event,
  fixtureTransport,
  homeserver,
  roomId,
  sync,
  userId,
} from "./fixtures/matrix.js";
import { account, limits } from "./fixtures/signed.js";

// Supply-chain policy disables postinstall downloads. Native integration is available
// only when the operator has independently provisioned the SDK's native library.
const nativeAvailable = readdirSync(
  dirname(fileURLToPath(import.meta.resolve("@matrix-org/matrix-sdk-crypto-nodejs"))),
).some((file) => file.endsWith(".node"));
it.skipIf(!nativeAvailable)(
  "decrypts a synthetic fixture session using the real Rust SDK, then ingests it",
  async () => {
    const { OlmMachine, UserId, DeviceId, RoomId, EncryptionSettings } = await import(
      "@matrix-org/matrix-sdk-crypto-nodejs"
    );
    const machine = await OlmMachine.initialize(new UserId(userId), new DeviceId("SYNTHETIC"));
    try {
      const room = new RoomId(roomId);
      await machine.shareRoomKey(room, [], new EncryptionSettings());
      const content = JSON.parse(
        await machine.encryptRoomEvent(
          room,
          "m.room.message",
          JSON.stringify({ msgtype: "m.text", body: "Synthetic encrypted fixture" }),
        ),
      );
      const encrypted = { ...event(), type: "m.room.encrypted", content };
      const fake = fixtureTransport([direct, sync([encrypted])]);
      const crypto = await createMatrixCrypto(machine);
      const binding = createMatrixReader({
        account,
        homeserver,
        userId,
        tokens: new RecordingTokenProvider(),
        crypto,
        transport: fake.options,
      });
      const page = await binding.ingest.list(account, undefined, limits);
      expect(page.items).toHaveLength(1);
      expect(
        binding.ingest.parse(page.items[0] as NonNullable<(typeof page.items)[0]>),
      ).toMatchObject({ channel: "matrix", textBody: "Synthetic encrypted fixture" });
      expect(fake.requests).toHaveLength(2);
    } finally {
      machine.close();
    }
  },
);
