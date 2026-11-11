// AUTHORED-BY Codex GPT-6
import { createPrivateKey, sign } from "node:crypto";
import type { PushTransport, TransportResult } from "./push-delivery.js";

export interface FcmMessage {
  message: {
    token: string;
    data: { p: string };
    android: { priority: "HIGH"; ttl: "86400s" };
  };
}
export function buildFcmMessage(token: string, p: string): FcmMessage {
  return { message: { token, data: { p }, android: { priority: "HIGH", ttl: "86400s" } } };
}
export interface FcmOptions {
  projectId: string;
  serviceAccount: { client_email: string; private_key: string };
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}
type Token = { value: string; expires: number };
const tokenUrl = "https://oauth2.googleapis.com/token";

/** Fixed provider endpoints only; inbound URLs/headers never enter this authenticated transport. */
export function createFcmTransport(options: FcmOptions): PushTransport<FcmMessage> {
  if (!/^[a-zA-Z0-9-]+$/u.test(options.projectId) || !options.serviceAccount.client_email)
    throw new Error("Invalid FCM configuration");
  const key = createPrivateKey(options.serviceAccount.private_key);
  if (key.asymmetricKeyType !== "rsa") throw new Error("FCM requires an RSA key");
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  let cached: Token | undefined;
  let pending: Promise<string | TransportResult> | undefined;
  async function refresh(): Promise<string | TransportResult> {
    const iat = Math.floor(now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        iss: options.serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: tokenUrl,
        iat,
        exp: iat + 3600,
      }),
    ).toString("base64url");
    const input = `${header}.${claims}`;
    const assertion = `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return result(response);
    }
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (
      !body ||
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0
    )
      return { status: 502 };
    cached = { value: body.access_token, expires: now() + body.expires_in * 1000 };
    return cached.value;
  }
  async function token(): Promise<string | TransportResult> {
    if (cached && cached.expires - 300_000 > now()) return cached.value;
    if (!pending) pending = refresh();
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  }
  return {
    async send(message) {
      const accessToken = await token();
      if (typeof accessToken !== "string") return accessToken;
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${options.projectId}/messages:send`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(message),
        },
      );
      if (response.status === 401 || response.status === 403) cached = undefined;
      const mapped = result(response);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { details?: { errorCode?: unknown }[] };
        } | null;
        const details = body?.error?.details;
        if (Array.isArray(details)) {
          const reason = details.find((detail) => typeof detail?.errorCode === "string")?.errorCode;
          if (typeof reason === "string") mapped.reason = reason;
        }
      } else await response.body?.cancel();
      return mapped;
    },
  };
}

function result(response: Response): TransportResult {
  const retryAfter = response.headers.get("retry-after");
  return { status: response.status, ...(retryAfter === null ? {} : { retryAfter }) };
}
