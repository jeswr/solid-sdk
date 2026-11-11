// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createDecipheriv, createECDH, createHmac } from "node:crypto";
import type { ActivityPayload, ChallengePayload } from "../src/push-payload.js";
import type { Installation } from "../src/push-state.js";

// RFC 8291 section 5 keys; these are public test fixtures, never production credentials.
export const receiverPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
export const receiverPublic =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
export const auth = "BTBZMqHH6r4Tts7J_aSIgg";
export const activity: ActivityPayload = {
  v: 1,
  id: "activity-1",
  kind: "chat",
  registrationId: "account-1",
  topicIndex: 3,
  sentAt: 1_800_000_000_000,
};
export const challenge: ChallengePayload = {
  v: 1,
  id: "challenge-1",
  kind: "challenge",
  nonce: "activation-nonce",
  sentAt: activity.sentAt,
};
export const installation: Installation = {
  installationId: "phone-1",
  platform: "android",
  pushToken: "device-token",
  tokenVersion: 1,
  devicePublicKey: receiverPublic,
  authSecret: auth,
  deviceSigningKey: {},
  activated: true,
  challengeHash: "",
  challengeAttempts: [],
  createdAt: activity.sentAt,
  admittedBy: "https://alice.example/profile/card#me",
};

/** Independent receiver, following the mobile HMAC implementation rather than the sender's HKDF API. */
export function decrypt(encoded: string): Buffer {
  const body = Buffer.from(encoded, "base64url");
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(Buffer.from(receiverPrivate, "base64url"));
  const sender = body.subarray(21, 86);
  const hmac = (key: Buffer, value: Buffer) => createHmac("sha256", key).update(value).digest();
  const ikm = hmac(
    hmac(Buffer.from(auth, "base64url"), receiver.computeSecret(sender)),
    Buffer.concat([
      Buffer.from("WebPush: info\0"),
      receiver.getPublicKey(),
      sender,
      Buffer.from([1]),
    ]),
  );
  const prk = hmac(body.subarray(0, 16), ikm);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(body.subarray(-16));
  return Buffer.concat([decipher.update(body.subarray(86, -16)), decipher.final()]);
}
