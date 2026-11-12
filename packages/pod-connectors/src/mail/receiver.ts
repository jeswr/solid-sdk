// AUTHORED-BY Codex GPT-6.1-Sol
import { asciiLower } from "./markup-html.js";
import { emailMarkupTrust, type MailMarkupAuthentication } from "./markup-types.js";

function normalizedDomain(value: string | undefined): string | undefined {
  const domain = asciiLower(value ?? "");
  return domain.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)
    ? domain
    : undefined;
}

export function mailDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let address = value;
  try {
    if (address.startsWith("mailto:")) address = decodeURIComponent(address.slice(7));
  } catch {
    return undefined;
  }
  const at = address.lastIndexOf("@");
  if (at <= 0 || address.indexOf("@") !== at) return undefined;
  return normalizedDomain(address.slice(at + 1));
}

/** Preserve header order and duplicates. Never inspect body text or an incomplete header. */
export function receiverHeaders(raw: Uint8Array): readonly [string, string][] {
  const text = new TextDecoder().decode(raw.subarray(0, 64 * 1024));
  const end = /\r?\n\r?\n/.exec(text);
  if (!end) return [];
  return text
    .slice(0, end.index)
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
      return match
        ? [[asciiLower(match[1] as string), match[2] as string] as [string, string]]
        : [];
    });
}

/** Recognize the authority before validating its result syntax, so unsupported syntax
 * cannot cause a later, sender-supplied assertion to become authoritative. */
function googleAuthserv(value: string): boolean {
  let i = 0;
  while (i < value.length) {
    if (/\s/.test(value[i] as string)) {
      i++;
      continue;
    }
    if (value[i] !== "(") break;
    let depth = 1;
    while (++i < value.length && depth) {
      if (value[i] === "\\") i++;
      else if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
    }
    if (depth) return false;
  }
  return /^(?:mx\.google\.com|"mx\.google\.com")(?=[\s(;]|$)/i.test(value.slice(i));
}

/** Only Google's first matching receiver assertion is authoritative. Fail closed on ambiguity. */
export function googleAuthentication(
  raw: Uint8Array,
  from: string | undefined,
): MailMarkupAuthentication | undefined {
  const domain = mailDomain(from);
  if (!domain) return undefined;
  const value = receiverHeaders(raw).find(
    ([key, value]) => key === "authentication-results" && googleAuthserv(value),
  )?.[1];
  if (!value || !/^mx\.google\.com\s*;/i.test(value.trim())) return undefined;
  const clauses = value
    .split(";")
    .slice(1)
    .filter((clause) => /^\s*dmarc\s*=/i.test(clause));
  if (clauses.length !== 1) return undefined;
  // Comments and quoted strings cannot supply authentication tokens.
  const clause = (clauses[0] as string).replace(/\([^()]*\)/g, " ");
  if (/[()"\\]/.test(clause) || !/^\s*dmarc\s*=\s*pass(?:\s|$)/i.test(clause)) return undefined;
  const matches = [...clause.matchAll(/(?:^|\s)header\.from\s*=\s*([^\s;]+)/gi)];
  if (matches.length !== 1) return undefined;
  const headerFrom = matches[0]?.[1];
  const alignedDomain = normalizedDomain(headerFrom);
  if (!alignedDomain || (domain !== alignedDomain && !domain.endsWith(`.${alignedDomain}`)))
    return undefined;
  return { dmarc: "pass", alignedDomain };
}

export function markupSender(
  from: string | undefined,
  authentication?: MailMarkupAuthentication,
): { senderKey?: string; trust: "verified" | "unverified" } {
  const domain = mailDomain(from);
  const aligned = normalizedDomain(authentication?.alignedDomain ?? domain);
  const verified =
    domain &&
    aligned &&
    (domain === aligned || domain.endsWith(`.${aligned}`)) &&
    emailMarkupTrust(authentication) === "verified";
  return { senderKey: verified ? aligned : domain, trust: verified ? "verified" : "unverified" };
}

/** A host/source receiver timestamp is capped at import time; missing time stays unknown. */
export function receiverTime(value?: Date, now = new Date()): Date | undefined {
  return value && Number.isFinite(value.getTime())
    ? new Date(Math.min(value.getTime(), now.getTime()))
    : undefined;
}

/** Top-most Received added by a Google MX, never the sender's Date header. */
export function googleReceivedTime(raw: Uint8Array): Date | undefined {
  // Gmail prepends its receiver trace. Never search past an unrecognized top trace into
  // sender-supplied Received headers; Takeout has the separator clock as a fallback.
  const value = receiverHeaders(raw).find(([key]) => key === "received")?.[1];
  if (!value) return undefined;
  const trace = value.replace(/\([^()]*\)/g, " ");
  if (/[()]/.test(trace)) return undefined;
  const receivers = [...trace.matchAll(/\bby\s+([^\s;]+)/gi)];
  if (
    receivers.length !== 1 ||
    !/^(?:[a-z0-9-]+\.)*(?:google\.com|googlemail\.com)$/i.test(receivers[0]?.[1] ?? "")
  )
    return undefined;
  const semicolon = value.lastIndexOf(";");
  return semicolon < 0 ? undefined : receiverTime(new Date(value.slice(semicolon + 1).trim()));
}
