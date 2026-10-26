// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, randomBytes } from "node:crypto";
import { isLoopbackAddress } from "@jeswr/guarded-fetch";

/** OAuth protocol error with a safe, static description. */
export class OAuthError extends Error {
  constructor(
    public readonly error: string,
    public readonly status = 400,
  ) {
    super(error);
  }
}

export const MAX_BYTES = 64 * 1024;
export const LOGIN_TTL = 600;
export const CODE_TTL = 300;
export const GRANT_TTL = 30 * 24 * 60 * 60;
export const ACCESS_TTL = 600;

export function opaque(): string {
  return randomBytes(32).toString("base64url");
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthError("invalid_request");
  }
  return value as Record<string, unknown>;
}

export function parameter(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  if (values.length !== 1 || !values[0]) throw new OAuthError("invalid_request");
  return values[0];
}

export function unique(params: URLSearchParams): void {
  const names = new Set<string>();
  for (const name of params.keys()) {
    if (names.has(name)) throw new OAuthError("invalid_request");
    names.add(name);
  }
}

export function secureUrl(value: string, allowLoopback = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError("invalid_request");
  }
  const loopback =
    url.hostname === "localhost" || isLoopbackAddress(url.hostname.replace(/^\[|\]$/g, ""));
  if (
    (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash ||
    value.includes("#") ||
    /[\s\\]/u.test(value)
  ) {
    throw new OAuthError("invalid_request");
  }
  return url;
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}

export function redirect(uri: string, values: Record<string, string>): Response {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return new Response(null, {
    status: 302,
    headers: { location: url.href, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export async function readBodyBytes(message: Request | Response): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(message.headers.get("content-length")) > MAX_BYTES) {
    void message.body?.cancel().catch(() => {});
    throw new OAuthError("invalid_request", 413);
  }
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        void reader.cancel().catch(() => {});
        throw new OAuthError("invalid_request", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function readBody(message: Request | Response): Promise<string> {
  return Buffer.from(await readBodyBytes(message)).toString("utf8");
}

export function mediaType(message: Request | Response): string {
  const type = (message.headers.get("content-type") ?? "").split(";")[0] as string;
  return type.trim().toLowerCase();
}
