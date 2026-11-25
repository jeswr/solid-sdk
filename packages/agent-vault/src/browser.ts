// AUTHORED-BY Codex GPT-6
// Browser-safe schemas and cookie boundary. No host adapters or Node imports here.
import { z } from "zod";
import { publicSuffixRules } from "./public-suffix-rules.js";

export const cookieSchema = z.strictObject({
  name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  value: z
    .string()
    .max(8192)
    .regex(/^[\x21-\x3A\x3C-\x7E]*$/),
  domain: z.string().min(1).max(253),
  path: z.string().startsWith("/").max(2000),
  expires: z.number().finite().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  hostOnly: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
export const tokensSchema = z.strictObject({
  access: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/),
  refresh: z.string().min(1).max(8192).optional(),
  expiresAt: z.number().finite().nonnegative(),
  tokenEndpoint: z.string().optional(),
});
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const captureSchema = z.strictObject({
  site: z.string(),
  account: identifier.optional(),
  cookies: z.array(cookieSchema).max(300),
  tokens: tokensSchema.optional(),
  capturedAt: z.number().finite().nonnegative(),
});
export type SessionCapture = z.infer<typeof captureSchema>;
export const NATIVE_HOST_NAME = "org.jeswr.agent_vault";
export const NATIVE_MESSAGE_LIMIT = 1024 * 1024;
const id = z.number().int().min(1).max(2147483647);
export const nativeRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ id, type: z.literal("list"), site: z.string().max(2048) }),
  z.strictObject({
    id,
    type: z.literal("beginLogin"),
    site: z.string().max(2048),
    persona: identifier,
    profile: identifier,
  }),
  z.strictObject({
    id,
    type: z.literal("capture"),
    token: z.string().uuid(),
    message: captureSchema,
  }),
]);
export const nativeResultSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("list"),
    profiles: z
      .array(z.strictObject({ id: identifier, label: z.string().min(1).max(100) }))
      .max(100),
    personas: z
      .array(
        z.strictObject({ id: identifier, profile: identifier, label: z.string().min(1).max(100) }),
      )
      .max(100),
    cookieDomains: z.array(z.string().min(1).max(253)).max(100),
  }),
  z.strictObject({ type: z.literal("beginLogin"), token: z.string().uuid() }),
  z.strictObject({ type: z.literal("capture") }),
]);
export const nativeResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ id, ok: z.literal(true), result: nativeResultSchema }),
  z.strictObject({
    id: id.or(z.literal(0)),
    ok: z.literal(false),
    error: z.enum(["invalid", "denied", "unavailable"]),
  }),
]);
export type NativeRequest = z.infer<typeof nativeRequestSchema>;
export type NativeResponse = z.infer<typeof nativeResponseSchema>;
export type NativeResult = z.infer<typeof nativeResultSchema>;

/** Exact origins only; callers extracting an active tab first discard its path/query. */
export function captureOrigin(input: string): string {
  try {
    const u = new URL(input);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    )
      throw 0;
    return u.origin;
  } catch {
    throw new Error("Invalid sign-in site.");
  }
}
const suffixes = new Set(
  publicSuffixRules.split("\n").map((rule) => {
    const prefix = rule.startsWith("!") ? "!" : rule.startsWith("*.") ? "*." : "";
    return prefix + new URL(`https://${rule.slice(prefix.length)}`).hostname;
  }),
);
/** PSL prevailing-rule algorithm, including private tenants, wildcard and exception rules. */
export function registrableDomain(host: string): string | undefined {
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[")) return undefined;
  const labels = host.split(".");
  let suffixLength = 1;
  for (let i = 0; i < labels.length; i++) {
    const tail = labels.slice(i).join(".");
    if (suffixes.has(`!${tail}`)) return labels.slice(-(labels.length - i)).join(".");
    if (suffixes.has(tail)) suffixLength = Math.max(suffixLength, labels.length - i);
    if (i > 0 && suffixes.has(`*.${tail}`))
      suffixLength = Math.max(suffixLength, labels.length - i + 1);
  }
  return labels.length > suffixLength ? labels.slice(-(suffixLength + 1)).join(".") : undefined;
}
export function cookieDomainAllowed(
  host: string,
  domain: string,
  hostOnly: boolean,
  parents: readonly string[],
): boolean {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (domain === host) return local || registrableDomain(host) !== undefined;
  if (hostOnly || local || /^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return (
    parents.includes(domain) &&
    host.endsWith(`.${domain}`) &&
    registrableDomain(domain) !== undefined &&
    registrableDomain(domain) === registrableDomain(host)
  );
}
