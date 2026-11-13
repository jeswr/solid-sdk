// AUTHORED-BY Codex GPT-6
import { type CryptoKey, type JWTPayload, jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { decodeBase64url, strictJson } from "../http.js";

const protectedHeaderSchema = z.strictObject({ alg: z.literal("ES256"), typ: z.string().min(1) });

export async function signAp2Jwt(
  payload: JWTPayload,
  key: CryptoKey,
  typ: string,
): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: "ES256", typ }).sign(key);
}

/** Caller supplies a pinned key; embedded keys and algorithm negotiation are refused. */
export async function verifyAp2Jwt(
  token: string,
  key: CryptoKey,
  typ: string,
  now: number,
  audience?: string,
): Promise<JWTPayload> {
  if (!Number.isSafeInteger(now) || now < 0 || token.length > 65_536)
    throw new Error("invalid JWT bounds or time");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid compact JWT");
  const header = protectedHeaderSchema.parse(strictJson(decodeBase64url(parts[0] as string), 1024));
  if (header.typ !== typ) throw new Error("invalid JWT type");
  const raw = strictJson(decodeBase64url(parts[1] as string));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("invalid JWT claims");
  const result = await jwtVerify(token, key, {
    algorithms: ["ES256"],
    typ,
    currentDate: new Date(now * 1000),
    ...(audience ? { audience } : {}),
  });
  return result.payload;
}
