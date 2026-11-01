// AUTHORED-BY Codex GPT-6.1-Sol
import { type AnyMessage, canonicalJson, parseBoundedJson } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { generateKeyPairSync, sign, verify } from "crypto";
import { RecordingTokenProvider } from "../../src/testing.js";

const key = generateKeyPairSync("ed25519");
export const at = Date.parse("2026-10-26T12:00:00Z");
export const account = { id: "test-account" };
export const limits = { maxItems: 10, maxBytes: 65536 };
export const message: AnyMessage = {
  profile: "https://agent.example/profile",
  configuration: "https://agent.example/config",
  id: "urn:example:message:1",
  conversation: "urn:example:conversation:1",
  kind: "describe",
  from: { actor: "https://sender.example/agent" },
  to: { actor: "https://receiver.example/agent" },
  createdAt: "2026-10-26T11:00:00Z",
  expiresAt: "2026-10-26T13:00:00Z",
  body: {},
};
export function signed(value: unknown = message) {
  const body = `${Buffer.from('{"alg":"EdDSA"}').toString("base64url")}.${Buffer.from(canonicalJson(value)).toString("base64url")}`;
  return {
    message: value as AnyMessage,
    compactJws: `${body}.${sign(null, Buffer.from(body), key.privateKey).toString("base64url")}`,
  };
}
export async function verifyMessage(jws: string): Promise<unknown> {
  const [header, payload, signature] = jws.split(".") as [string, string, string];
  if (
    header !== Buffer.from('{"alg":"EdDSA"}').toString("base64url") ||
    !verify(
      null,
      Buffer.from(`${header}.${payload}`),
      key.publicKey,
      Buffer.from(signature, "base64url"),
    )
  )
    throw new Error("invalid test signature");
  return parseBoundedJson(Buffer.from(payload, "base64url").toString("utf8"));
}
export function options() {
  return { tokens: new RecordingTokenProvider(), verify: verifyMessage, now: () => at };
}
