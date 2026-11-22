// AUTHORED-BY Codex GPT-6
import { CompactSign, type CryptoKey, compactVerify } from "jose";
import { z } from "zod";
import { canonicalJson } from "../../core/canonical.js";
import { base64url, decodeBase64url, type HttpExchange, header, strictJson } from "../http.js";
import { AcpError } from "./errors.js";
import { ACP_VERSION } from "./objects.js";

/** ACP leaves Signature and Timestamp optional. This local profile requires both.
 * Signature is a detached Ed25519 JWS over the JCS body; Timestamp is Unix seconds.
 * The research specifies only body coverage: Timestamp/method/path/headers are not signed.
 */
export async function signAcpExchange(
  exchange: HttpExchange,
  key: CryptoKey,
  timestamp: number,
): Promise<HttpExchange> {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new AcpError("invalid_timestamp", 400);
  const body = canonicalJson(z.json().parse(exchange.body));
  const signed = await new CompactSign(new TextEncoder().encode(body))
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(key);
  const parts = signed.split(".");
  const headers = Object.fromEntries(
    Object.entries(exchange.headers).filter(
      ([name]) => !["signature", "timestamp"].includes(name.toLowerCase()),
    ),
  );
  return {
    ...exchange,
    headers: { ...headers, Signature: `${parts[0]}..${parts[2]}`, Timestamp: String(timestamp) },
  };
}

export async function verifyAcpExchange(
  exchange: HttpExchange,
  key: CryptoKey,
  now: number,
  maxSkewSeconds = 300,
): Promise<void> {
  const signature = header(exchange.headers, "Signature");
  const timestamp = header(exchange.headers, "Timestamp");
  if (!signature || !timestamp) throw new AcpError("unsigned-not-allowed", 401);
  if (
    !/^(0|[1-9]\d*)$/.test(timestamp) ||
    !Number.isSafeInteger(Number(timestamp)) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(maxSkewSeconds) ||
    maxSkewSeconds < 0 ||
    Math.abs(now - Number(timestamp)) > maxSkewSeconds
  )
    throw new AcpError("invalid_timestamp", 401);
  try {
    const parts = signature.split(".");
    if (parts.length !== 3 || parts[1] !== "") throw new Error("invalid detached signature");
    z.strictObject({ alg: z.literal("EdDSA") }).parse(
      strictJson(decodeBase64url(parts[0] as string), 1024),
    );
    const payload = base64url(canonicalJson(z.json().parse(exchange.body)));
    await compactVerify(`${parts[0]}.${payload}.${parts[2]}`, key, { algorithms: ["EdDSA"] });
  } catch {
    throw new AcpError("invalid_signature", 401);
  }
}

/** Header checks are separate from signature checks so either side can verify a response. */
export function checkAcpRequestHeaders(exchange: HttpExchange): void {
  if (!/^Bearer [^\s]+$/.test(header(exchange.headers, "Authorization") ?? ""))
    throw new AcpError("authorization_required", 401);
  if (header(exchange.headers, "API-Version") !== ACP_VERSION)
    throw new AcpError("unsupported_api_version", 400);
  if (exchange.method.toUpperCase() === "POST" && !header(exchange.headers, "Idempotency-Key"))
    throw new AcpError("idempotency_key_required", 400);
}
