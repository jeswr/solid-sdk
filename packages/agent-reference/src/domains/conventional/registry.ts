/**
 * UC-02 / R25: supported conventional scheduling services and the URL policy for links
 * found in email.
 *
 * The registry is LOCAL, reviewed configuration ("installed through the trusted software
 * process"): which hosts and path shapes a fixed adapter understands, and which adapter
 * version implements them. A link in an email can only ever be MATCHED against this
 * registry; it is never used as a request target. The adapter calls the API base the local
 * operator configured for the service, with identifiers that passed a strict pattern — so an
 * extracted URL cannot become an SSRF path, and a message cannot choose an adapter.
 */
import { AWP } from "../../profile/vocabulary.js";

export const CONVENTIONAL_BOOK_OP = {
  id: `${AWP}op/book-remembered-service`,
  version: "0.1",
} as const;

export interface SupportedService {
  readonly id: string;
  readonly label: string;
  /** Exact hostnames (no wildcards). */
  readonly hosts: readonly string[];
  /** Path shape: exactly two identifiers (owner handle, event type). */
  readonly pathPattern: RegExp;
  readonly adapterVersion: string;
  readonly limitations: readonly string[];
}

/**
 * The one supported service: a SYNTHETIC Calendly-style link format on a reserved example
 * domain, backed by the local reference service in `slots-service.ts`. No real provider.
 */
export const SYNTHETIC_SLOTS: SupportedService = {
  id: "synthetic-slots/1",
  label:
    "Synthetic slot-booking service (local stand-in for a Calendly-style provider; NOT Calendly)",
  hosts: ["book.slots.example"],
  pathPattern: /^\/([a-z0-9][a-z0-9-]{0,39})\/([a-z0-9][a-z0-9-]{0,39})\/?$/,
  adapterVersion: "1.0.0",
  limitations: ["synthetic provider only", "no live Calendly API is called or supported"],
};

export const REGISTRY: readonly SupportedService[] = [SYNTHETIC_SLOTS];

export type LinkVerdict =
  | {
      readonly ok: true;
      readonly service: SupportedService;
      readonly identifiers: { readonly user: string; readonly event: string };
      readonly canonical: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "unparseable"
        | "unsupported-scheme"
        | "credentials-in-url"
        | "unsupported-port"
        | "ip-literal"
        | "unsupported-host"
        | "unsupported-path"
        | "unsupported-query"
        | "non-canonical-url"
        | "too-long";
      readonly url: string;
    };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Classify one URL against the registry. Pure; performs no network access. */
export function classifyLink(
  url: string,
  registry: readonly SupportedService[] = REGISTRY,
): LinkVerdict {
  const shown = url.slice(0, 200);
  if (url.length > 2048) return { ok: false, reason: "too-long", url: shown };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "unparseable", url: shown };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "unsupported-scheme", url: shown };
  if (u.username || u.password) return { ok: false, reason: "credentials-in-url", url: shown };
  const host = u.hostname;
  if (IPV4.test(host) || host.startsWith("[") || host.includes(":"))
    return { ok: false, reason: "ip-literal", url: shown };
  if (u.port !== "") return { ok: false, reason: "unsupported-port", url: shown };
  // The link as written must already be canonical: the URL parser silently resolves dot
  // segments, backslashes and percent-encoding, which would change what the link names.
  const rawPath = /^https:\/\/[^/?#\\]+([^?#]*)/i.exec(url)?.[1] ?? "";
  if (rawPath !== u.pathname || /%|\\|\/\.\.?(\/|$)/.test(rawPath)) {
    return { ok: false, reason: "non-canonical-url", url: shown };
  }
  const service = registry.find((s) => s.hosts.includes(host));
  if (!service) return { ok: false, reason: "unsupported-host", url: shown };
  const m = service.pathPattern.exec(u.pathname);
  if (!m) return { ok: false, reason: "unsupported-path", url: shown };
  if (u.search !== "") return { ok: false, reason: "unsupported-query", url: shown };
  const identifiers = { user: m[1] as string, event: m[2] as string };
  return {
    ok: true,
    service,
    identifiers,
    canonical: `https://${host}/${identifiers.user}/${identifiers.event}`,
  };
}

/** Deterministic link extraction from plain text (bounded; no LLM). */
export function extractLinks(text: string, max = 20): string[] {
  const found = text.slice(0, 256 * 1024).match(/https?:\/\/[^\s<>"'()[\]{}]+/gi) ?? [];
  return [...new Set(found.map((s) => s.replace(/[.,;:!?]+$/, "")))].slice(0, max);
}
