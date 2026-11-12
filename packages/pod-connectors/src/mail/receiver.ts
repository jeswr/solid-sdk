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

interface HeaderToken {
  readonly kind: "atom" | "quoted" | "special";
  readonly text: string;
}

/** RFC 5322 CFWS-aware tokenization for structured header values. Comments (nested, with
 * quoted-pairs) are dropped, quoted strings become one token and `specials` stand alone.
 * Unbalanced comments or unterminated quoted strings fail closed. Linear in the input. */
function headerTokens(value: string, specials: string): HeaderToken[] | undefined {
  const tokens: HeaderToken[] = [];
  let i = 0;
  while (i < value.length) {
    const c = value[i] as string;
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
    } else if (c === "(") {
      let depth = 1;
      while (++i < value.length && depth) {
        if (value[i] === "\\") i++;
        else if (value[i] === "(") depth++;
        else if (value[i] === ")") depth--;
      }
      if (depth) return undefined;
    } else if (c === ")") {
      return undefined;
    } else if (c === '"') {
      let text = "";
      let closed = false;
      while (++i < value.length) {
        const q = value[i] as string;
        if (q === "\\") {
          if (++i >= value.length) return undefined;
          text += value[i];
        } else if (q === '"') {
          closed = true;
          i++;
          break;
        } else text += q;
      }
      if (!closed) return undefined;
      tokens.push({ kind: "quoted", text });
    } else if (specials.includes(c)) {
      tokens.push({ kind: "special", text: c });
      i++;
    } else {
      const start = i;
      while (
        i < value.length &&
        !/[\s()"]/.test(value[i] as string) &&
        !specials.includes(value[i] as string)
      )
        i++;
      tokens.push({ kind: "atom", text: value.slice(start, i) });
    }
  }
  return tokens;
}

const atom = (token: HeaderToken | undefined, text?: string): token is HeaderToken =>
  token?.kind === "atom" && (text === undefined || asciiLower(token.text) === text);
const special = (token: HeaderToken | undefined, text: string): boolean =>
  token?.kind === "special" && token.text === text;

function splitTokens(tokens: readonly HeaderToken[], separator: string): HeaderToken[][] {
  const parts: HeaderToken[][] = [[]];
  for (const token of tokens) {
    if (special(token, separator)) parts.push([]);
    else (parts[parts.length - 1] as HeaderToken[]).push(token);
  }
  return parts;
}

interface ReceivedTrace {
  readonly clauses: ReadonlyMap<string, string>;
  readonly date: string;
}

const RECEIVED_CLAUSES = new Set(["from", "by", "via", "with", "id", "for"]);
/** Strict RFC 5321 trace: single-atom clauses, each at most once, then exactly one `; date`. */
function receivedTrace(value: string): ReceivedTrace | undefined {
  const tokens = headerTokens(value, ";");
  if (!tokens) return undefined;
  const parts = splitTokens(tokens, ";");
  if (parts.length !== 2) return undefined;
  const [clauseTokens, dateTokens] = parts as [HeaderToken[], HeaderToken[]];
  if (clauseTokens.length % 2 || !dateTokens.every((token) => atom(token))) return undefined;
  const clauses = new Map<string, string>();
  for (let i = 0; i < clauseTokens.length; i += 2) {
    const key = clauseTokens[i];
    const clause = clauseTokens[i + 1];
    if (!atom(key) || !atom(clause)) return undefined;
    const name = asciiLower(key.text);
    if (!RECEIVED_CLAUSES.has(name) || clauses.has(name)) return undefined;
    clauses.set(name, clause.text);
  }
  return { clauses, date: dateTokens.map((token) => token.text).join(" ") };
}

function ipLiteral(value: string): boolean {
  const host = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host.split(".").every((part) => +part <= 255);
  if (!/^[0-9a-f:]+$/i.test(host)) return false;
  const halves = host.split("::");
  if (halves.length > 2) return false;
  const groups = halves.map((half) => (half ? half.split(":") : []));
  if (groups.some((half) => half.some((group) => !/^[0-9a-f]{1,4}$/i.test(group)))) return false;
  const count = groups.reduce((total, half) => total + half.length, 0);
  return halves.length === 2 ? count < 8 : count === 8;
}

const GOOGLE_MX_PROTOCOLS = new Set(["ESMTP", "ESMTPS", "SMTPS"]);
const GOOGLE_RELAY_PROTOCOLS = new Set([
  "SMTP",
  "ESMTP",
  "ESMTPS",
  "ESMTPA",
  "ESMTPSA",
  "SMTPS",
  "LMTP",
]);
const GOOGLE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+google\.com$/;

/** `boundary` is Google's inbound MX receipt; `internal` a Google relay above it. A Google
 * POP3/IMAP/HTTP receipt (mail fetch, IMAP or API insertion) is never a trust anchor. */
function googleHop(trace: ReceivedTrace): "boundary" | "internal" | undefined {
  const by = asciiLower(trace.clauses.get("by") ?? "");
  const protocol = (trace.clauses.get("with") ?? "").toUpperCase();
  if (by === "mx.google.com")
    return trace.clauses.has("from") && GOOGLE_MX_PROTOCOLS.has(protocol) ? "boundary" : undefined;
  if (GOOGLE_HOST.test(by) && GOOGLE_RELAY_PROTOCOLS.has(protocol)) return "internal";
  if (ipLiteral(by) && protocol === "SMTP" && trace.clauses.has("id")) return "internal";
  return undefined;
}

/** Walk the header block top-down through Google's prepended trace. The inbound MX receipt
 * counts only below Google-internal hops; the first Google Authentication-Results counts only
 * directly below that receipt. Anything else ends Google's block and fails closed. */
function googleReceipt(
  headers: readonly (readonly [string, string])[],
): { readonly received: ReceivedTrace; readonly authentication?: string } | undefined {
  let receipt: ReceivedTrace | undefined;
  for (const [key, value] of headers) {
    if (key === "received") {
      // A trace below the receipt was added before Google; lower assertions are the sender's.
      if (receipt) return { received: receipt };
      const trace = receivedTrace(value);
      const hop = trace && googleHop(trace);
      if (hop === "boundary") receipt = trace;
      else if (hop !== "internal") return undefined;
    } else if (key === "authentication-results" && googleAuthserv(value)) {
      return receipt ? { received: receipt, authentication: value } : undefined;
    }
  }
  return receipt ? { received: receipt } : undefined;
}

const PROPERTY = /^[a-z0-9-]+\.[a-z0-9_.-]+$/i;
/** Only Google's positionally anchored receiver assertion is authoritative. Result clauses are
 * split per RFC 8601 after CFWS tokenization, so quoted values and comments cannot inject one. */
export function googleAuthentication(
  raw: Uint8Array,
  from: string | undefined,
): MailMarkupAuthentication | undefined {
  const domain = mailDomain(from);
  if (!domain) return undefined;
  const value = googleReceipt(receiverHeaders(raw))?.authentication;
  const tokens = value === undefined ? undefined : headerTokens(value, ";=");
  if (!tokens) return undefined;
  const [authserv, ...results] = splitTokens(tokens, ";");
  if (authserv?.length !== 1 || !atom(authserv[0], "mx.google.com")) return undefined;
  const dmarc = results.filter((clause) => atom(clause[0], "dmarc"));
  if (dmarc.length !== 1) return undefined;
  const clause = dmarc[0] as HeaderToken[];
  if (!special(clause[1], "=") || !atom(clause[2], "pass")) return undefined;
  let i = 3;
  if (atom(clause[i], "reason") && special(clause[i + 1], "=") && clause[i + 2]?.kind !== "special")
    i += 3;
  const headerFrom: HeaderToken[] = [];
  for (; i < clause.length; i += 3) {
    const property = clause[i];
    const pvalue = clause[i + 2];
    if (!atom(property) || !PROPERTY.test(property.text) || !special(clause[i + 1], "="))
      return undefined;
    if (!pvalue || pvalue.kind === "special") return undefined;
    if (asciiLower(property.text) === "header.from") headerFrom.push(pvalue);
  }
  if (headerFrom.length !== 1 || !atom(headerFrom[0])) return undefined;
  const alignedDomain = normalizedDomain(headerFrom[0].text);
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

/** Google's inbound MX receipt time, under the same positional rule as its authentication
 * result; never the sender's Date header or a lower, sender-supplied Received header. */
export function googleReceivedTime(raw: Uint8Array): Date | undefined {
  const date = googleReceipt(receiverHeaders(raw))?.received.date;
  return date ? receiverTime(new Date(date)) : undefined;
}
