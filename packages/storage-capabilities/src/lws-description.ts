// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

  function timestamp(value: unknown, field: string): string {
    const text = string(value, field);
    const parts =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
        text,
      );
    if (!parts || parts[0] !== text) invalid(`${field} must be a timestamp with a timezone`);
    const year = Number(parts[1]);
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = Number(parts[4]);
    const minute = Number(parts[5]);
    const second = Number(parts[6]);
    const offsetHour = Number(parts[8] ?? 0);
    const offsetMinute = Number(parts[9] ?? 0);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth =
      [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
    // Check local calendar components before any Date parsing can normalise an
    // impossible date. XSD permits 24:00:00 only at midnight, and offsets up to 14:00.
    if (
      day < 1 ||
      day > daysInMonth ||
      hour > 24 ||
      minute > 59 ||
      second > 59 ||
      (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(parts[7] ?? ""))) ||
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      invalid(`${field} must be a valid calendar timestamp with a timezone`);
    }
    return text;
  }

  function array(value: unknown, field: string): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) invalid(`${field} must be an array`);
    return value;
  }

  function strings(value: unknown, field: string): string[] {
    return (Array.isArray(value) ? value : [value]).map((item) => string(item, field));
  }

  function jwk(value: unknown): JsonWebKey {
    const key = record(value, "publicKeyJwk");
    // CID public keys must not contain any JOSE private or secret key parameters,
    // even when the parameter belongs to a different key type.
    for (const field of ["d", "p", "q", "dp", "dq", "qi", "oth", "k", "priv"]) {
      if (field in key) invalid(`publicKeyJwk must not contain private or secret ${field}`);
    }
    const kty = string(key.kty, "publicKeyJwk kty");
    let required: readonly string[];
    switch (kty) {
      case "EC":
        required = ["crv", "x", "y"];
        break;
      case "RSA":
        required = ["n", "e"];
        break;
      case "OKP":
        required = ["crv", "x"];
        break;
      default:
        return invalid("publicKeyJwk kty is unsupported");
    }
    for (const field of required) string(key[field], `publicKeyJwk ${field}`);
    // Check public Web Crypto JsonWebKey members, plus the standard JOSE metadata.
    // Unknown extension members remain data; cryptographic usability is checked at key import.
    for (const field of [
      "alg",
      "crv",
      "e",
      "n",
      "use",
      "x",
      "y",
      "kid",
      "x5u",
      "x5t",
      "x5t#S256",
    ]) {
      if (key[field] !== undefined && typeof key[field] !== "string") {
        invalid(`publicKeyJwk ${field} must be a string`);
      }
    }
    if (key.ext !== undefined && typeof key.ext !== "boolean") {
      invalid("publicKeyJwk ext must be a boolean");
    }
    for (const field of ["key_ops", "x5c"]) {
      for (const item of array(key[field], `publicKeyJwk ${field}`)) {
        string(item, `publicKeyJwk ${field} member`);
      }
    }
    return key;
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
      publicKeyJwk: jwk(method.publicKeyJwk),
      ...(method.revoked === undefined
        ? {}
        : { revoked: timestamp(method.revoked, "verificationMethod revoked") }),
      ...(method.expires === undefined
        ? {}
        : { expires: timestamp(method.expires, "verificationMethod expires") }),
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
