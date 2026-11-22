// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/suspicious/noControlCharactersInRegex: HTTP auth syntax must refuse control characters. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { canonicalJson } from "../../core/canonical.js";
import {
  authorizationSchema,
  type Eip712Domain,
  signAuthorization,
  signatureSchema,
} from "../eip3009.js";
import { decodeBase64url, decodeJson, encodeJson, type HttpExchange } from "../http.js";
import { convertMoney, type Money, type UnitAmount } from "../money.js";

const boundText = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^|\r\n\x00-\x1f\x7f]*$/);
const token = z.string().regex(/^[a-z][a-z0-9_-]*$/);
export const chargeRequestSchema = z.strictObject({
  amount: z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(78),
  currency: z.string().min(2).max(128),
  recipient: z.string().min(1).optional(),
  description: z.string().optional(),
  externalId: z.string().min(1).optional(),
  methodDetails: z.record(z.string(), z.json()).optional(),
});
export const challengeSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  realm: boundText,
  method: token,
  intent: token,
  request: z.string().regex(/^[A-Za-z0-9_-]+$/),
  expires: z.iso.datetime({ offset: true }).optional(),
  digest: boundText.optional(),
  description: z
    .string()
    .regex(/^[^\x00-\x1f\x7f]*$/)
    .optional(),
  header: z.literal("Payment-Authorization").optional(),
  opaque: boundText.optional(),
});
const evmPayloadSchema = authorizationSchema.extend({
  type: z.literal("authorization"),
  signature: signatureSchema,
});
export const credentialSchema = z.strictObject({
  challenge: challengeSchema,
  payload: evmPayloadSchema,
  source: z.string().regex(/^did:pkh:eip155:[1-9]\d*:0x[0-9a-fA-F]{40}$/),
});
export const receiptSchema = z.strictObject({
  status: z.literal("success"),
  method: z.literal("evm"),
  timestamp: z.iso.datetime({ offset: true }),
  reference: z.string().min(1),
  challengeId: z.string().min(1),
  chainId: z.string().regex(/^[1-9]\d*$/),
});
export const problemStatuses = {
  "payment-required": 402,
  "payment-insufficient": 402,
  "payment-expired": 402,
  "verification-failed": 402,
  "method-unsupported": 400,
  "malformed-credential": 402,
  "invalid-challenge": 402,
  "bad-request": 400,
  "invalid-payload": 402,
  "internal-payment-error": 500,
  "payment-action-required": 402,
} as const;
export type ProblemCode = keyof typeof problemStatuses;
export class MppError extends Error {
  readonly status: number;
  readonly type: string;
  constructor(public readonly code: ProblemCode) {
    super(code);
    this.status = problemStatuses[code];
    this.type = `https://paymentauth.org/problems/${code}`;
  }
}
export type ChargeRequest = z.infer<typeof chargeRequestSchema>;
export type Challenge = z.infer<typeof challengeSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type PaymentReceipt = z.infer<typeof receiptSchema>;

/** Fixed eight slots, empty when absent. Pipes in bound values are refused. */
export function challengeId(challenge: Omit<Challenge, "id">, secret: Uint8Array): string {
  const checked = challengeSchema.parse({ ...challenge, id: "placeholder" });
  if (secret.length < 32) throw new Error("challenge secret needs 32 bytes");
  const binding = [
    checked.realm,
    checked.method,
    checked.intent,
    checked.request,
    checked.expires ?? "",
    checked.digest ?? "",
    checked.header ?? "",
    checked.opaque ?? "",
  ].join("|");
  return createHmac("sha256", secret).update(binding).digest("base64url");
}

export function checkChallengeBinding(challenge: Challenge, secret: Uint8Array): boolean {
  try {
    const actual = decodeBase64url(challenge.id);
    const expected = decodeBase64url(challengeId(challenge, secret));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createChallenge(
  request: ChargeRequest,
  options: Omit<Challenge, "id" | "request">,
  secret: Uint8Array,
): Challenge {
  const value = {
    ...options,
    request: encodeJson(chargeRequestSchema.parse(request), "base64url"),
  };
  return challengeSchema.parse({ ...value, id: challengeId(value, secret) });
}

/** The source does not define challenge hash bytes: this profile hashes its JCS echo. */
export function challengeNonce(challenge: Challenge): string {
  return `0x${createHash("sha256")
    .update(canonicalJson(challengeSchema.parse(challenge)))
    .digest("hex")}`;
}

export function chargeRequest(challenge: Challenge): ChargeRequest {
  const parsed = chargeRequestSchema.parse(decodeJson(challenge.request, "base64url"));
  if (encodeJson(parsed, "base64url") !== challenge.request)
    throw new MppError("invalid-challenge");
  return parsed;
}

export function buildChallenge(challenge: Challenge): string {
  return `Payment ${Object.entries(challengeSchema.parse(challenge))
    .map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(", ")}`;
}

/** RFC 9110 token / quoted-string auth params; unknown parameters are ignored. */
export function parseChallenge(value: string): Challenge {
  if (value.length > 32_768) throw new MppError("invalid-challenge");
  const prefix = /^Payment[ \t]+/i.exec(value);
  if (!prefix) throw new MppError("invalid-challenge");
  const parameters: Record<string, string> = {};
  let rest = value.slice(prefix[0].length);
  while (rest.length) {
    const match =
      /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)[ \t]*=[ \t]*(?:"((?:[^"\\\x00-\x1f\x7f]|\\[\x20-\x7e])*)"|([!#$%&'*+.^_`|~0-9A-Za-z-]+))[ \t]*(,|$)/.exec(
        rest,
      );
    if (!match) throw new MppError("invalid-challenge");
    const key = (match[1] as string).toLowerCase();
    if (Object.hasOwn(parameters, key)) throw new MppError("invalid-challenge");
    parameters[key] =
      match[2] === undefined ? (match[3] as string) : match[2].replace(/\\(.)/g, "$1");
    rest = rest.slice(match[0].length).replace(/^[ \t]*/, "");
    if (match[4] === "," && !rest) throw new MppError("invalid-challenge");
  }
  const known = Object.fromEntries(
    Object.entries(parameters).filter(([key]) => Object.hasOwn(challengeSchema.shape, key)),
  );
  const result = challengeSchema.safeParse(known);
  if (!result.success) throw new MppError("invalid-challenge");
  chargeRequest(result.data);
  return result.data;
}

export function createCredential(
  challenge: Challenge,
  domain: Eip712Domain,
  from: string,
  validAfter: string,
  validBefore: string,
  secretKey: Uint8Array,
): Credential {
  const request = chargeRequest(challenge);
  if (!request.recipient) throw new MppError("invalid-payload");
  const auth = authorizationSchema.parse({
    from,
    to: request.recipient,
    value: request.amount,
    validAfter,
    validBefore,
    nonce: challengeNonce(challenge),
  });
  return credentialSchema.parse({
    challenge,
    source: `did:pkh:eip155:${domain.chainId}:${from.toLowerCase()}`,
    payload: {
      type: "authorization",
      ...auth,
      signature: signAuthorization(domain, auth, secretKey),
    },
  });
}

export function buildCredential(credential: Credential): string {
  return `Payment ${encodeJson(credentialSchema.parse(credential), "base64url")}`;
}
export function parseCredential(value: string): Credential {
  const match = /^Payment ([A-Za-z0-9_-]+)$/i.exec(value);
  if (!match) throw new MppError("malformed-credential");
  try {
    return credentialSchema.parse(decodeJson(match[1] as string, "base64url"));
  } catch {
    throw new MppError("malformed-credential");
  }
}
export function encodeReceipt(value: PaymentReceipt): string {
  return encodeJson(receiptSchema.parse(value), "base64url");
}
export function parseReceipt(value: string, status: number): PaymentReceipt {
  if (status !== 200) throw new MppError("bad-request");
  return receiptSchema.parse(decodeJson(value, "base64url"));
}
export function challengeExchange(
  method: string,
  path: string,
  challenge: Challenge,
): HttpExchange {
  return {
    method,
    path,
    status: 402,
    headers: { "WWW-Authenticate": buildChallenge(challenge), "Cache-Control": "no-store" },
    body: null,
  };
}

export function convertMppAmount(value: Money, decimals: number): UnitAmount;
export function convertMppAmount(value: UnitAmount, decimals: number): Money;
export function convertMppAmount(value: Money | UnitAmount, decimals: number): Money | UnitAmount {
  return "amount" in value ? convertMoney(value, decimals) : convertMoney(value, decimals);
}
