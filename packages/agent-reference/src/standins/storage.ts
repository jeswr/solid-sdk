// AUTHORED-BY Codex GPT-6
/** Fictional Solid HTTP subset. No sockets, OAuth issuer or full server conformance is claimed. */
import { assertWithinPodScope, createGuardedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { z } from "zod";
import { digestBytes } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import {
  type PublicKeyRecord,
  type SigningKey,
  signCompact,
  verifyCompact,
} from "../mechanisms/jws.js";
import {
  type AccessMode,
  type AccessRule,
  accessDocument,
  accessModes,
  containerDocument,
} from "../model/solid-storage.js";

export const STORAGE_LIMIT = 1024 * 1024;
export type StorageFetch = ReturnType<typeof createGuardedFetch>;
const AUTH_TYPE = "fictional-solid-http+jws";
const requestAuthentication = z.strictObject({
  actor: z.string(),
  method: z.string(),
  url: z.string(),
  body: z.string(),
  headers: z.string(),
  at: z.iso.datetime(),
  nonce: z.string().min(1).max(128),
});
export interface StorageAccess {
  readonly method: string;
  readonly url: string;
  readonly actor?: string;
  readonly status: number;
  readonly bodyDigest: string;
}
interface Resource {
  body: string;
  type: string;
  container: boolean;
}
export function modeForRequest(method: string, url: string): AccessMode {
  if (new URL(url).pathname.toLowerCase().replace(/\/$/, "").endsWith(".acl")) return "Control";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return "Read";
  return method === "POST" && url.endsWith("/") ? "Append" : "Write";
}
export class FictionalSolidStorage {
  readonly accessLog: StorageAccess[] = [];
  available = true;
  private readonly resources = new Map<string, Resource>();
  private readonly identities = new Map<string, PublicKeyRecord & { actor: string }>();
  private readonly nonces = new Set<string>();
  private next = 0;
  constructor(
    readonly origin: string,
    readonly identity: string,
    readonly key: SigningKey,
    private readonly now: () => string,
  ) {}
  introduce(actor: string, key: PublicKeyRecord): void {
    this.identities.set(key.kid, { ...key, actor });
  }
  /** Provisioning is the operator's explicit fixture setup, never a client authorization path. */
  async provision(
    url: string,
    owner: string,
    options: {
      body?: string;
      type?: string;
      container?: boolean;
      rules?: readonly AccessRule[];
    } = {},
  ): Promise<void> {
    const target = assertWithinPodScope(`${this.origin}/`, url);
    this.resources.set(target, {
      body: options.body ?? "",
      type: options.type ?? "text/turtle",
      container: options.container ?? target.endsWith("/"),
    });
    this.resources.set(`${target}.acl`, {
      body: await accessDocument(`${target}.acl`, [
        {
          resource: target,
          agent: owner,
          modes: ["Read", "Write", "Control"],
          defaults: target.endsWith("/"),
        },
        ...(options.rules ?? []),
      ]),
      type: "text/turtle",
      container: false,
    });
  }
  /** Deliberately hostile operator, used only by the changed-at-rest branch. */
  alterAtRest(url: string, change: (body: string) => string): void {
    const resource = this.resources.get(url);
    if (!resource) throw new Error("Missing resource for hostile storage mutation");
    resource.body = change(resource.body);
  }
  private async modes(url: string, actor?: string): Promise<Set<AccessMode>> {
    const protectedUrl = url.endsWith(".acl") ? url.slice(0, -4) : url;
    const own = this.resources.get(`${protectedUrl}.acl`);
    if (own) return accessModes(own.body, `${protectedUrl}.acl`, protectedUrl, actor, false);
    let parent = new URL(protectedUrl.endsWith("/") ? ".." : ".", protectedUrl).href;
    while (parent.startsWith(`${this.origin}/`)) {
      const acl = this.resources.get(`${parent}.acl`);
      if (acl) return accessModes(acl.body, `${parent}.acl`, parent, actor, true);
      if (parent === `${this.origin}/`) break;
      parent = new URL("..", parent).href;
    }
    return new Set();
  }
  private async authenticate(
    request: Request,
    body: string,
  ): Promise<{ actor?: string; invalid?: true }> {
    const auth = request.headers.get("authorization");
    if (!auth) return {};
    if (!auth.startsWith("FictionalSignature ")) return { invalid: true };
    const verified = await verifyCompact(auth.slice(19), {
      typ: AUTH_TYPE,
      allowedAlgs: ["EdDSA"],
      limits: DEFAULT_LIMITS,
      resolve: (kid) => this.identities.get(kid),
    });
    if (verified.outcome !== "valid") return { invalid: true };
    const parsed = requestAuthentication.safeParse(verified.payload);
    if (!parsed.success) return { invalid: true };
    const payload = parsed.data;
    if (
      payload.actor !== verified.pinned.actor ||
      payload.method !== request.method ||
      payload.url !== request.url ||
      payload.body !== digestBytes(body) ||
      payload.headers !== boundHeaders(request.headers) ||
      !payload.at ||
      Math.abs(Date.parse(payload.at) - Date.parse(this.now())) > 60000 ||
      !Number.isFinite(Date.parse(payload.at)) ||
      !payload.nonce ||
      this.nonces.has(payload.nonce)
    )
      return { invalid: true };
    this.nonces.add(payload.nonce);
    return { actor: verified.pinned.actor };
  }
  async handle(request: Request): Promise<Response> {
    const body = await request.text();
    const identity = await this.authenticate(request, body);
    const reply = async (status: number, text = "", headers: Record<string, string> = {}) => {
      const entry = {
        method: request.method,
        url: request.url,
        ...(identity.actor ? { actor: identity.actor } : {}),
        status,
        bodyDigest: digestBytes(text),
      };
      this.accessLog.push(entry);
      return new Response(request.method === "HEAD" || status === 204 ? null : text, {
        status,
        headers: {
          ...headers,
          "x-fictional-storage-receipt": await signCompact(
            this.key,
            "fictional-solid-response+jws",
            entry,
          ),
        },
      });
    };
    try {
      assertWithinPodScope(`${this.origin}/`, request.url);
    } catch {
      return reply(400);
    }
    if (Buffer.byteLength(body) > STORAGE_LIMIT) return reply(413);
    if (!this.available) return reply(503);
    if (identity.invalid) return reply(401, "", { "www-authenticate": "FictionalSignature" });
    let modes: Set<AccessMode>;
    try {
      modes = await this.modes(request.url, identity.actor);
    } catch {
      return reply(403);
    }
    if (!modes.has(modeForRequest(request.method, request.url)))
      return reply(
        identity.actor ? 403 : 401,
        "",
        identity.actor ? {} : { "www-authenticate": "FictionalSignature" },
      );
    const resource = this.resources.get(request.url);
    const etag = resource ? `"${digestBytes(resource.body)}"` : undefined;
    if (request.headers.has("if-match") && request.headers.get("if-match") !== etag)
      return reply(412);
    if (request.headers.get("if-none-match") === "*" && resource) return reply(412);
    const link = `<${request.url}.acl>; rel="acl"`;
    switch (request.method) {
      case "HEAD":
      case "GET": {
        if (!resource) return reply(404);
        const children = [...this.resources]
          .filter(
            ([url]) =>
              url !== request.url &&
              !url.endsWith(".acl") &&
              new URL(url.endsWith("/") ? ".." : ".", url).href === request.url,
          )
          .map(([url, value]) => ({
            url,
            container: value.container,
            size: Buffer.byteLength(value.body),
          }));
        const text = resource.container
          ? await containerDocument(request.url, children)
          : resource.body;
        const publicModes = await this.modes(request.url);
        const names = (set: Set<AccessMode>) =>
          ["Read", "Write", "Append", "Control"]
            .filter((m) => set.has(m as AccessMode))
            .map((m) => m.toLowerCase())
            .join(" ");
        return reply(200, text, {
          "content-type": resource.container ? "text/turtle" : resource.type,
          etag: etag ?? "",
          link,
          "wac-allow": `user="${names(modes)}",public="${names(publicModes)}"`,
        });
      }
      case "PUT": {
        const container = request.url.endsWith("/");
        const parent = new URL(container ? ".." : ".", request.url).href;
        if (!resource && !this.resources.get(parent)?.container) return reply(409);
        if (request.url.endsWith(".acl")) {
          try {
            await accessModes(body, request.url, request.url.slice(0, -4), identity.actor, false);
          } catch {
            return reply(400);
          }
        }
        this.resources.set(request.url, {
          body,
          type: request.headers.get("content-type") ?? "application/octet-stream",
          container,
        });
        return reply(resource ? 204 : 201, "", { link });
      }
      case "POST": {
        if (!resource?.container) return reply(409);
        const slug = request.headers.get("slug") ?? `item-${++this.next}`;
        if (
          !/^[A-Za-z0-9._-]+$/.test(slug) ||
          slug === "." ||
          slug === ".." ||
          slug.toLowerCase().endsWith(".acl")
        )
          return reply(409);
        let target = new URL(slug, request.url).href;
        if (this.resources.has(target))
          target = new URL(`${++this.next}-${slug}`, request.url).href;
        this.resources.set(target, {
          body,
          type: request.headers.get("content-type") ?? "application/octet-stream",
          container: false,
        });
        return reply(201, "", { location: target, link: `<${target}.acl>; rel="acl"` });
      }
      case "DELETE":
        if (!resource) return reply(404);
        if (
          resource.container &&
          [...this.resources.keys()].some(
            (url) =>
              url !== request.url && url !== `${request.url}.acl` && url.startsWith(request.url),
          )
        )
          return reply(409);
        this.resources.delete(request.url);
        this.resources.delete(`${request.url}.acl`);
        return reply(204);
      default:
        return reply(405, "", { allow: "GET, HEAD, POST, PUT, DELETE" });
    }
  }
  /** The injected DNS pins one registered in-process host; no request can escape to a socket. */
  client(actor?: string, key?: SigningKey, maxBytes = STORAGE_LIMIT): StorageFetch {
    const transport: StorageFetch = async (input, init) => {
      const request = new Request(input, init);
      const body = await request.clone().text();
      if (actor && key) {
        request.headers.set(
          "authorization",
          `FictionalSignature ${await signCompact(key, AUTH_TYPE, { actor, method: request.method, url: request.url, body: digestBytes(body), headers: boundHeaders(request.headers), at: this.now(), nonce: crypto.randomUUID() })}`,
        );
      }
      return this.handle(request);
    };
    return refuseRedirects(
      createGuardedFetch({
        pinningFetch: transport,
        dnsLookup: async (host) => {
          if (host !== new URL(this.origin).hostname)
            throw new Error("No fictional DNS entry for this host");
          return [{ address: "93.184.216.34", family: 4 }];
        },
        requireDnsPinning: true,
        maxBytes,
        maxRedirects: 0,
      }),
    );
  }
}
function boundHeaders(headers: Headers): string {
  return JSON.stringify(
    ["content-type", "slug", "if-match", "if-none-match"].map((name) => [name, headers.get(name)]),
  );
}
