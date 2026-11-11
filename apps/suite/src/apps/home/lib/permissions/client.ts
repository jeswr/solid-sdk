// AUTHORED-BY Codex GPT-6.1-Sol
import {
  classifyIpLiteral,
  DEFAULT_HOSTNAME_DENYLIST,
  isDeniedHostname,
  isPublicAddress,
  normalizeHostForClassification,
} from "@jeswr/guarded-fetch";
import { httpUrl } from "../model/rdf";
import { demoClientResource } from "./demo-client";

export interface ClientMetadata {
  name?: string;
  uri?: string;
  logoUri?: string;
  policyUri?: string;
  tosUri?: string;
}
const cache = new Map<string, { until: number; value: Promise<ClientMetadata> }>();
const DAY = 24 * 60 * 60 * 1000;
/** A failed or timed-out lookup is retried after this, never held for a day. */
export const CLIENT_RETRY_MS = 5 * 60 * 1000;
export const CLIENT_TIMEOUT_MS = 5000;
function https(value: unknown): value is string {
  const url = typeof value === "string" ? httpUrl(value) : undefined;
  if (url?.protocol !== "https:") return false;
  const host = normalizeHostForClassification(url.hostname);
  return (
    !isDeniedHostname(host, [...DEFAULT_HOSTNAME_DENYLIST, "localhost", "local"]) &&
    (classifyIpLiteral(host) === 0 ? host.includes(".") : isPublicAddress(host, false))
  );
}
const publicClientFetch: typeof globalThis.fetch = async (input, init) =>
  (await demoClientResource(String(input), init)) ?? globalThis.fetch(input, init);
/** Client ID Documents have a path; a bare origin (an acl:origin value) is never fetched. */
export function isClientIdDocument(value: string): boolean {
  return https(value) && new URL(value).pathname !== "/";
}
/** The optional fetch is an unauthenticated transport seam, NEVER a session fetch. */
export async function resolveClientName(
  clientId: string,
  publicFetch: typeof globalThis.fetch = publicClientFetch,
  now: number = Date.now(),
): Promise<ClientMetadata> {
  if (!isClientIdDocument(clientId)) return {};
  const hit = cache.get(clientId);
  if (hit && now < hit.until) return { ...(await hit.value) };
  // Concurrent callers share the request; it is bounded even if the transport ignores abort.
  const entry = { until: now + DAY, value: Promise.resolve<ClientMetadata>({}) };
  entry.value = (async (): Promise<ClientMetadata> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Client ID Document timed out"));
      }, CLIENT_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([
        publicFetch(clientId, {
          headers: { accept: "application/ld+json, application/json" },
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        }),
        timeout,
      ]);
      if (!response.ok) throw new Error(`Client ID Document unavailable (${response.status})`);
      if (
        !["application/json", "application/ld+json"].includes(
          response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
        )
      )
        return {};
      let json: unknown;
      try {
        json = await Promise.race([response.json(), timeout]);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return {};
      }
      if (!json || typeof json !== "object" || Array.isArray(json)) return {};
      const doc = json as Record<string, unknown>;
      const result: ClientMetadata = {};
      if (typeof doc.client_name === "string") result.name = doc.client_name;
      for (const [field, property] of [
        ["client_uri", "uri"],
        ["logo_uri", "logoUri"],
        ["policy_uri", "policyUri"],
        ["tos_uri", "tosUri"],
      ] as const)
        if (https(doc[field])) result[property] = doc[field];
      return result;
    } catch {
      // Transport failures, refusals and timeouts are transient: retry soon.
      entry.until = now + CLIENT_RETRY_MS;
      return {};
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(clientId, entry);
  return { ...(await entry.value) };
}
