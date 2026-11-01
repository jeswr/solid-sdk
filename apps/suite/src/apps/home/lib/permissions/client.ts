// AUTHORED-BY Codex GPT-6.1-Sol
import { httpUrl } from "../model/rdf";

export interface ClientMetadata {
  name?: string;
  uri?: string;
  logoUri?: string;
  policyUri?: string;
  tosUri?: string;
}
const cache = new Map<string, { until: number; value: Promise<ClientMetadata> }>();
const DAY = 24 * 60 * 60 * 1000;
function https(value: unknown): value is string {
  return typeof value === "string" && httpUrl(value)?.protocol === "https:";
}
/** The optional fetch is an unauthenticated transport seam, NEVER a session fetch. */
export async function resolveClientName(
  clientId: string,
  publicFetch: typeof globalThis.fetch = globalThis.fetch,
  now: number = Date.now(),
): Promise<ClientMetadata> {
  if (!https(clientId)) return {};
  const hit = cache.get(clientId);
  if (hit && now < hit.until) return { ...(await hit.value) };
  const value = (async (): Promise<ClientMetadata> => {
    try {
      const response = await publicFetch(clientId, {
        headers: { accept: "application/ld+json, application/json" },
        credentials: "omit",
        redirect: "error",
      });
      if (
        !response.ok ||
        !["application/json", "application/ld+json"].includes(
          response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
        )
      )
        return {};
      const json: unknown = await response.json();
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
      return {};
    }
  })();
  cache.set(clientId, { until: now + DAY, value });
  return { ...(await value) };
}
