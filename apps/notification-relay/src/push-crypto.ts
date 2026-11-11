// AUTHORED-BY Codex GPT-6
import { createCipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import type { PushPayload } from "./push-payload.js";

export interface EncryptionOptions {
  salt?: Uint8Array;
  /** Raw P-256 private scalar. Deterministic fixtures only; omit in production. */
  ephemeral?: Uint8Array;
}

function decode(value: string, length: number): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value)
    throw new Error("Invalid push encryption input");
  return bytes;
}

/** Internal RFC-vector seam. Production callers must use encryptPayload for fixed-size padding. */
export function encryptRecord(
  plaintext: Uint8Array,
  devicePublicKey: string,
  authSecret: string,
  opts: EncryptionOptions = {},
): string {
  if (plaintext.length > 3993) throw new Error("Push record too large");
  const receiver = decode(devicePublicKey, 65);
  if (receiver[0] !== 4) throw new Error("Invalid push public key");
  const auth = decode(authSecret, 16);
  const salt = opts.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("Invalid push salt");
  const sender = createECDH("prime256v1");
  if (opts.ephemeral) sender.setPrivateKey(opts.ephemeral);
  else sender.generateKeys();
  const publicKey = sender.getPublicKey();
  // computeSecret validates the recipient point, including curve membership.
  const shared = sender.computeSecret(receiver);
  const ikm = hkdfSync(
    "sha256",
    shared,
    auth,
    Buffer.concat([Buffer.from("WebPush: info\0"), receiver, publicKey]),
    32,
  );
  const key = hkdfSync(
    "sha256",
    Buffer.from(ikm),
    salt,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    Buffer.from(ikm),
    salt,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const cipher = createCipheriv("aes-128-gcm", Buffer.from(key), Buffer.from(nonce));
  const header = Buffer.alloc(21);
  header.set(salt);
  header.writeUInt32BE(4096, 16);
  header[20] = 65;
  return Buffer.concat([
    header,
    publicKey,
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url");
}

export function encryptPayload(
  payload: PushPayload,
  devicePublicKey: string,
  authSecret: string,
  opts?: EncryptionOptions,
): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  if (json.length > 512) throw new Error("Push plaintext too large");
  const padded = Buffer.alloc(512, 0x20);
  padded.set(json);
  return encryptRecord(padded, devicePublicKey, authSecret, opts);
}
