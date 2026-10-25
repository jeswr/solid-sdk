// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { mediaType, OAuthError, object, readBody, secureUrl } from "./protocol.js";
import type { Client, RecordStore } from "./types.js";

export function clientMetadata(value: unknown, id: string, now: number): Client {
  const data = object(value);
  if (!Array.isArray(data.redirect_uris) || data.redirect_uris.length === 0) {
    throw new OAuthError("invalid_redirect_uri");
  }
  const redirects = data.redirect_uris.map((uri: unknown) => {
    if (typeof uri !== "string") throw new OAuthError("invalid_redirect_uri");
    try {
      secureUrl(uri, true);
    } catch {
      throw new OAuthError("invalid_redirect_uri");
    }
    return uri;
  });
  const grants = data.grant_types ?? ["authorization_code", "refresh_token"];
  if (
    !Array.isArray(grants) ||
    !grants.includes("authorization_code") ||
    grants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token") ||
    (data.response_types !== undefined &&
      (!Array.isArray(data.response_types) ||
        data.response_types.length !== 1 ||
        data.response_types[0] !== "code")) ||
    (data.token_endpoint_auth_method !== undefined && data.token_endpoint_auth_method !== "none") ||
    data.client_secret !== undefined ||
    data.client_secret_expires_at !== undefined ||
    (data.client_name !== undefined &&
      (typeof data.client_name !== "string" || data.client_name.length > 256))
  ) {
    throw new OAuthError("invalid_client_metadata");
  }
  return {
    client_id: id,
    client_id_issued_at: now,
    ...(data.client_name === undefined ? {} : { client_name: data.client_name as string }),
    redirect_uris: [...new Set(redirects)],
    grant_types: [...new Set(grants)] as string[],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export class Clients {
  private readonly cache = new Map<string, { client: Client; expiresAt: number }>();
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly store: RecordStore<Client>,
    private readonly now: () => number,
    fetcher?: typeof fetch,
  ) {
    this.fetcher =
      fetcher ??
      createNodeGuardedFetch({
        maxBytes: 64 * 1024,
        timeoutMs: 8_000,
        maxRedirects: 0,
      });
  }

  async get(id: string): Promise<Client> {
    const registered = await this.store.get(id);
    if (registered) return registered;
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.client);
    this.cache.delete(id);
    try {
      secureUrl(id);
      // Validate raw path components before WHATWG URL normalization can erase them.
      if (!/^https:\/\/[^/]+\//u.test(id) || /\/(?:\.|%2e){1,2}(?:\/|\?|$)/iu.test(id)) {
        throw new OAuthError("invalid_client");
      }
      const response = await this.fetcher(id, {
        redirect: "manual",
        credentials: "omit",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      const type = mediaType(response);
      if (
        response.status !== 200 ||
        (type !== "application/json" && !/^application\/.+\+json$/u.test(type))
      ) {
        throw new OAuthError("invalid_client");
      }
      const data = object(JSON.parse(await readBody(response)));
      if (data.client_id !== id) throw new OAuthError("invalid_client");
      const client = clientMetadata(data, id, this.now());
      const control = response.headers.get("cache-control") ?? "";
      const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/iu.exec(control)?.[1];
      const age = Number(response.headers.get("age") ?? 0);
      const ttl = Math.max(
        0,
        Math.min(300, Number(maxAge ?? 300)) - (Number.isFinite(age) && age >= 0 ? age : 300),
      );
      if (!/(?:^|,)\s*(?:no-store|no-cache)\b/iu.test(control) && ttl > 0) {
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(id, { client: structuredClone(client), expiresAt: this.now() + ttl });
      }
      return client;
    } catch {
      // Network failures and malformed metadata must not leak attacker-controlled content.
      throw new OAuthError("invalid_client", 401);
    }
  }
}
