// AUTHORED-BY Codex GPT-6
import { createPublicKey, ECDH } from "node:crypto";
import type { JWK } from "jose";
import type { Installation, PushRegistration } from "./push-state.js";
import { safeUrl } from "./signatures.js";

export class PushError extends Error {
  constructor(readonly status: number) {
    super("Push request refused");
  }
}
export function requirePush(condition: unknown, status = 400): asserts condition {
  if (!condition) throw new PushError(status);
}
export function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  requirePush(value && typeof value === "object" && !Array.isArray(value));
  requirePush(Object.keys(value).every((key) => fields.includes(key)));
  return value as Record<string, unknown>;
}
export function encodedBytes(value: unknown, length: number): Buffer {
  requirePush(typeof value === "string");
  const bytes = Buffer.from(value, "base64url");
  requirePush(bytes.length === length && bytes.toString("base64url") === value);
  return bytes;
}
export function signingKey(value: unknown): JWK {
  const key = object(value, ["kty", "crv", "x", "y"]);
  requirePush(key.kty === "EC" && key.crv === "P-256");
  encodedBytes(key.x, 32);
  encodedBytes(key.y, 32);
  createPublicKey({ key, format: "jwk" });
  return key as JWK;
}
export type InstallationInput = Pick<
  Installation,
  "platform" | "pushToken" | "devicePublicKey" | "authSecret" | "deviceSigningKey"
>;
const installationFields = [
  "pushToken",
  "devicePublicKey",
  "authSecret",
  "deviceSigningKey",
] as const;
export function installationInput(value: unknown): InstallationInput {
  const body = object(value, ["platform", ...installationFields]);
  requirePush(body.platform === "android" || body.platform === "ios");
  requirePush(
    typeof body.pushToken === "string" &&
      body.pushToken.length > 0 &&
      body.pushToken.length <= 4096,
  );
  const point = encodedBytes(body.devicePublicKey, 65);
  requirePush(point[0] === 4);
  ECDH.convertKey(point, "prime256v1");
  encodedBytes(body.authSecret, 16);
  signingKey(body.deviceSigningKey);
  return body as unknown as InstallationInput;
}
export function installationPatch(value: unknown): Partial<Omit<InstallationInput, "platform">> {
  const body = object(value, installationFields);
  requirePush(Object.keys(body).length > 0);
  return body;
}
export type RegistrationInput = Omit<
  PushRegistration,
  "registrationId" | "expiresAt" | "inboxSecretHash"
>;
export function registrationInput(value: unknown, allowLoopback?: boolean): RegistrationInput {
  const body = object(value, ["installationId", "webId", "protocol", "storage", "topics"]);
  requirePush(
    typeof body.installationId === "string" && /^[\w-]{1,128}$/u.test(body.installationId),
  );
  safeUrl(body.webId, allowLoopback);
  safeUrl(body.storage, allowLoopback);
  requirePush(body.protocol === "solid" || body.protocol === "lws");
  requirePush(Array.isArray(body.topics) && body.topics.length <= 16);
  const indices = new Set<number>();
  for (const value of body.topics) {
    const topic = object(value, ["index", "kind", "topic", "channel", "sender", "expiresAt"]);
    requirePush(
      Number.isSafeInteger(topic.index) &&
        (topic.index as number) >= 0 &&
        !indices.has(topic.index as number),
    );
    indices.add(topic.index as number);
    requirePush(topic.kind === "inbox" || topic.kind === "chat");
    safeUrl(topic.topic, allowLoopback);
    safeUrl(topic.channel, allowLoopback);
    if (topic.sender !== undefined) safeUrl(topic.sender, allowLoopback);
    requirePush(Number.isSafeInteger(topic.expiresAt) && (topic.expiresAt as number) > 0);
  }
  return body as unknown as RegistrationInput;
}

/** JSON only, strict UTF-8, at most 64 KiB. Empty cleanup/rotation bodies hash as empty bytes. */
export async function pushBody(request: Request, empty: boolean): Promise<Buffer> {
  if (!request.body) {
    requirePush(empty);
    return Buffer.alloc(0);
  }
  requirePush(
    /^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? ""),
  );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requirePush(length <= 65_536, 413);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}
export function parseBody(body: Buffer): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
