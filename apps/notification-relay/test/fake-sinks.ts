// AUTHORED-BY Codex GPT-6
import type { ApnsMessage } from "../src/apns.js";
import type { FcmMessage } from "../src/fcm.js";
import type { PushTransport } from "../src/push-delivery.js";

/** Test-only provider boundary: records encrypted wire messages for independent decryption. */
export function createFakeSinks() {
  const android: FcmMessage[] = [];
  const ios: ApnsMessage[] = [];
  const fcm: PushTransport<FcmMessage> = {
    async send(message) {
      android.push(structuredClone(message));
      return { status: 200 };
    },
  };
  const apns: PushTransport<ApnsMessage> = {
    async send(message) {
      ios.push(structuredClone(message));
      return { status: 200 };
    },
  };
  return { fcm, apns, android, ios };
}
