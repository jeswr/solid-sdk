// AUTHORED-BY Codex GPT-6.1-Sol
import { CapabilitiesError } from "./errors.js";
import type { CapabilityEntry, ServiceEntry, StorageDescription } from "./types.js";
import { LWS } from "./vocab.js";

const LWS_NAMESPACE = "https://www.w3.org/ns/lws#";
const DEFAULT_TTL_MS = 3_600_000;

/**
 * Parse an already decoded CID body, regardless of its response media type.
 * Accepts the compact LWS shape used by application/lws+cid, application/cid,
 * and application/ld+json; does not fetch or process remote JSON-LD contexts.
 * HTTP cache metadata and injected clocks are applied by the resolver.
 * @throws {CapabilitiesError} For an invalid shape/id or a foreign storage authority.
 */
export function parseLwsDescription(
  json: unknown,
  storageUrl: string,
  requestUrl: string,
): StorageDescription {
  function invalid(message: string): never {
    throw new CapabilitiesError("description-invalid", storageUrl, message);
  }

  function record(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      invalid(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
  }

  function string(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      invalid(`${field} must be a nonempty string`);
    }
    return value;
  }

  function url(value: unknown, field: string): URL {
    const text = string(value, field);
    try {
      return new URL(text);
    } catch {
      return invalid(`${field} must be an absolute URL`);
    }
  }

  function array(value: unknown, field: string): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) invalid(`${field} must be an array`);
    return value;
  }

  function strings(value: unknown, field: string): string[] {
    return (Array.isArray(value) ? value : [value]).map((item) => string(item, field));
  }

  function expand(term: string): string {
    return term.includes(":") ? term : `${LWS_NAMESPACE}${term}`;
  }

  function types(value: unknown): string[] {
    const result = strings(value, "type").map(expand);
    if (result.length === 0) invalid("type must not be empty");
    return result;
  }

  function extraFields(extra: Record<string, unknown>): Record<string, unknown> {
    if (extra.subscriptionType !== undefined) {
      const expanded = strings(extra.subscriptionType, "subscriptionType").map(expand);
      extra.subscriptionType = Array.isArray(extra.subscriptionType) ? expanded : expanded[0];
    }
    return extra;
  }

  function sameAuthority(left: URL, right: URL): boolean {
    return (
      left.protocol === right.protocol &&
      left.host === right.host &&
      left.username === right.username &&
      left.password === right.password
    );
  }

  const body = record(json, "description");
  const location = url(storageUrl, "storageUrl");
  const request = url(requestUrl, "requestUrl");
  if (url(body.id, "id").href !== location.href) invalid("id does not match storageUrl");
  if (!types(body.type).includes(LWS.Storage)) invalid("type must include Storage");

  const services: ServiceEntry[] = array(body.service, "service").map((value) => {
    const { type, serviceEndpoint, id, conformsTo, ...extra } = record(value, "service entry");
    return {
      type: types(type),
      endpoint: url(serviceEndpoint, "serviceEndpoint").href,
      ...(id === undefined ? {} : { id: string(id, "service id") }),
      ...(conformsTo === undefined ? {} : { conformsTo: strings(conformsTo, "conformsTo") }),
      extra: extraFields(extra),
    };
  });
  const roots = services.filter((service) => service.type.includes(LWS.StorageRoot));
  const root = roots[0];
  if (!root || roots.length !== 1) invalid("service must contain exactly one StorageRoot");
  if (!sameAuthority(location, request) || !sameAuthority(new URL(root.endpoint), request)) {
    throw new CapabilitiesError(
      "root-mismatch",
      storageUrl,
      "Description and StorageRoot must have the request URL's scheme and authority",
    );
  }

  const capabilities: CapabilityEntry[] = array(body.capability, "capability").map((value) => {
    const { type, id, ...extra } = record(value, "capability entry");
    return {
      type: types(type),
      ...(id === undefined ? {} : { id: string(id, "capability id") }),
      extra: extraFields(extra),
    };
  });
  const verificationMethods: StorageDescription["verificationMethods"][number][] = [];
  for (const value of array(body.verificationMethod, "verificationMethod")) {
    const method = record(value, "verificationMethod entry");
    // The public verificationMethods contract includes only JWK-backed methods.
    if (method.publicKeyJwk === undefined) continue;
    verificationMethods.push({
      id: string(method.id, "verificationMethod id"),
      type: string(method.type, "verificationMethod type"),
      controller: string(method.controller, "verificationMethod controller"),
      publicKeyJwk: record(method.publicKeyJwk, "publicKeyJwk"),
    });
  }

  return {
    protocol: "lws",
    id: location.href,
    root: root.endpoint,
    descriptionUrl: location.href,
    services,
    capabilities,
    sources: ["lws-cid"],
    fetchedAt: Date.now(),
    etag: null,
    maxAgeMs: DEFAULT_TTL_MS,
    verificationMethods,
  };
}
