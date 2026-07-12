// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Public-address classification for SSRF defence — the MECHANICAL IP primitive of the guard.
 *
 * Consolidated from the four divergent suite copies (prod-solid-server `@pss/guarded-fetch`
 * `addresses.ts`, federation-client `ssrf.ts`, solid-community-feeds `safeFetch.ts`,
 * solid-agent-notify `security/ssrf.ts`). The POLICY (which ranges count as public, the
 * loopback-only dev override, the embedded-v4 re-check for IPv4-mapped/6to4/NAT64) is the
 * strongest of all four; the LITERAL PARSING + byte extraction is delegated to the vetted,
 * zero-dependency `ipaddr.js` (the task's "small reviewed policy core over a mechanical IP
 * primitive" architecture).
 *
 * WHY two distinct primitives live here, and what each is for:
 *
 *  1. {@link classifyIpLiteral} — a `node:net#isIP`-EQUIVALENT, browser-safe (pure-JS, no
 *     `node:` import) literal recogniser. It answers "is this URL host a STRICT IP literal
 *     as `new URL().hostname` would present it?" — used by the guard to decide whether a
 *     host goes to DNS (a name) or is classified directly (a literal). It is STRICT: it
 *     rejects leading-zero / hex / decimal / short-form encodings exactly like `isIP`, and
 *     is fuzzed against the real `node:net#isIP` in the tests to stay in lock-step. It is
 *     NOT `ipaddr.js.isValid` (which ACCEPTS those alternate encodings — see the note on
 *     {@link isPublicAddress}). The browser branch needs an `isIP` that imports no `node:`
 *     builtin, hence the hand-rolled implementation.
 *
 *  2. {@link isPublicAddress} / {@link isLoopbackAddress} — the public-routability POLICY,
 *     applied to a concrete address STRING (an IP literal from a URL host, or a record
 *     returned by DNS). These parse via `ipaddr.js` and decide public-vs-refused. Because
 *     `ipaddr.js.parse` accepts alternate IPv4 encodings (decimal `2130706433`, hex
 *     `0x7f000001`, octal `0177.0.0.1`, short-form `127.1`), an attacker who slips such a
 *     form past `classifyIpLiteral` (which would treat it as a NAME) is still caught when
 *     it is fed here — defence in depth. `new URL()` already canonicalises every numeric
 *     IPv4 encoding to dotted-decimal, so in practice the guard never sees the alternate
 *     forms; we classify them correctly anyway.
 *
 * Refuses: loopback, link-local (incl. the cloud metadata endpoint 169.254.169.254), IPv4
 * private (RFC 1918), CGNAT (RFC 6598), IPv4 reserved/TEST-NET/benchmarking ranges,
 * multicast, broadcast, IPv4 `0.0.0.0/8` (unspecified), IPv4-mapped IPv6, IPv6 ULA
 * (`fc00::/7`), IPv6 unspecified, **6to4 (`2002::/16`) embedding a non-public v4**, and
 * **NAT64 (`64:ff9b::/96`) embedding a non-public v4**. `allowLoopback` re-permits loopback
 * ONLY (dev / IT) — never RFC 1918 / link-local / metadata.
 */
import ipaddr from "ipaddr.js";

/** Matches one canonical IPv4 dotted-decimal octet: 0, or 1–255 with no leading zero. */
const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;

/**
 * Browser-safe equivalent of `node:net#isIP`. Returns `4` for a valid IPv4 literal, `6`
 * for a valid IPv6 literal, or `0` for anything else (a hostname, a malformed literal, a
 * bracketed literal, leading/trailing whitespace, an alternate-encoded IPv4, …). Pure JS —
 * imports no `node:` builtin — so the module needs no polyfill in a browser bundle.
 *
 * STRICT (matching `isIP`): canonical dotted-decimal IPv4 with no leading zeros / hex /
 * extra octets, and canonical colon-hex IPv6 with at most one `::` and an optional embedded
 * IPv4 in the last 32 bits. We do NOT delegate this to `ipaddr.js.isValid`: that helper
 * accepts leading zeros + alternate encodings, which would make `classifyIpLiteral`
 * over-broad (treating `01.02.03.04` as a literal `isIP` rejects), drifting from the
 * browser-safe `isIP` contract the guard relies on. The test suite fuzzes this against the
 * real `node:net#isIP` over a large corpus to keep them in lock-step.
 */
export function classifyIpLiteral(value: string): 0 | 4 | 6 {
  if (isIpv4Literal(value)) {
    return 4;
  }
  if (isIpv6Literal(value)) {
    return 6;
  }
  return 0;
}

/** Strict canonical IPv4: exactly four octets 0–255, no leading zeros, no hex/space. */
function isIpv4Literal(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) {
      return false;
    }
    if (Number.parseInt(part, 10) > 255) {
      return false;
    }
  }
  return true;
}

/**
 * Strict canonical IPv6 (matching `node:net#isIP`'s acceptance set): hextet groups
 * separated by `:`, at most ONE `::` compression, optional trailing embedded IPv4 in the
 * last 32 bits. Each non-embedded group is 1–4 hex digits. Accepts a non-empty zone id
 * (`fe80::1%eth0`) exactly as `isIP` does. Rejects bracketed forms, empty/leading zones,
 * double `::`, over-/under-length, and whitespace.
 */
function isIpv6Literal(value: string): boolean {
  // `node:net#isIP` accepts a scoped/zone id (`fe80::1%eth0`): the part before `%` must be
  // a valid IPv6 and the zone after `%` must be NON-EMPTY with no further `%`.
  const pct = value.indexOf("%");
  if (pct !== -1) {
    const zone = value.slice(pct + 1);
    if (zone.length === 0 || zone.includes("%")) {
      return false;
    }
    return isIpv6Literal(value.slice(0, pct));
  }
  if (value.length === 0 || /[^0-9a-fA-F:.]/.test(value)) {
    return false;
  }
  // At most one "::" compression marker.
  const compressionMatches = value.match(/::/g);
  if (compressionMatches && compressionMatches.length > 1) {
    return false;
  }
  const hasCompression = value.includes("::");

  // A trailing embedded IPv4 (e.g. `::ffff:1.2.3.4`) occupies the final two hextets.
  let core = value;
  let embeddedV4Groups = 0;
  const lastColon = value.lastIndexOf(":");
  const dot = value.indexOf(".");
  if (dot !== -1) {
    // The dotted part must be the suffix after the final colon, and a valid IPv4.
    if (lastColon === -1 || lastColon > dot) {
      return false;
    }
    const v4 = value.slice(lastColon + 1);
    if (!isIpv4Literal(v4)) {
      return false;
    }
    core = value.slice(0, lastColon + 1); // keep the trailing ':' so split logic is uniform
    embeddedV4Groups = 2; // an embedded v4 fills two 16-bit groups
  }

  const requiredGroups = 8 - embeddedV4Groups;
  if (hasCompression) {
    const idx = core.indexOf("::");
    const headStr = core.slice(0, idx);
    // For the embedded-v4 case `core` ends with a ':'; drop the trailing empty token.
    let tailStr = core.slice(idx + 2);
    if (embeddedV4Groups > 0 && tailStr.endsWith(":")) {
      tailStr = tailStr.slice(0, -1);
    }
    const head = headStr === "" ? [] : headStr.split(":");
    const tail = tailStr === "" ? [] : tailStr.split(":");
    if (!head.every(isHextet) || !tail.every(isHextet)) {
      return false;
    }
    // "::" must stand in for AT LEAST ONE zero group, so head+tail must be < required.
    if (head.length + tail.length >= requiredGroups) {
      return false;
    }
    return true;
  }
  // No compression: exactly `requiredGroups` groups, each a valid hextet.
  let groupsStr = core;
  if (embeddedV4Groups > 0 && groupsStr.endsWith(":")) {
    groupsStr = groupsStr.slice(0, -1);
  }
  const groups = groupsStr === "" ? [] : groupsStr.split(":");
  if (groups.length !== requiredGroups) {
    return false;
  }
  return groups.every(isHextet);
}

/** A single IPv6 hextet: 1–4 hex digits. */
function isHextet(group: string): boolean {
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}

// --- public-routability POLICY (ipaddr.js parses; the policy decides) -------

/**
 * IPv4 `ipaddr.js` `range()` values that are NEVER public. Everything `ipaddr.js` reports
 * as `private`/`loopback`/`linkLocal`/`carrierGradeNat`/`multicast`/`broadcast`/`reserved`/
 * `unspecified`/`benchmarking`/… is refused. The ONLY IPv4 range treated as public is
 * `unicast`. This is a CLOSED allowlist (default-deny): a future `ipaddr.js` range we have
 * not enumerated is refused unless it is `unicast`. Note `reserved` covers TEST-NET-1/2/3
 * (192.0.2/24, 198.51.100/24, 203.0.113/24) and benchmarking (198.18/15) — verified — so
 * the suite's explicit TEST-NET blocks are subsumed.
 */
const PUBLIC_IPV4_RANGE = "unicast";

/**
 * The IPv6 `range()` values treated as public. The suite's prior copies (and their tests)
 * treat the IPv6 DOCUMENTATION prefix `2001:db8::/32` as PUBLIC; `ipaddr.js` classifies it
 * `reserved`, so `reserved` must be in the allow-set to preserve parity (it is benign — a
 * documentation address routes nowhere). `unicast` is the normal public case. EVERYTHING
 * else (`loopback`, `linkLocal`, `uniqueLocal`, `multicast`, `unspecified`, `ipv4Mapped`,
 * `6to4`, `rfc6052`/NAT64, `teredo`, `orchid2`, …) is refused or routed through the
 * embedded-v4 re-check below. This is a CLOSED allowlist: an unknown range is refused.
 */
const PUBLIC_IPV6_RANGES: ReadonlySet<string> = new Set(["unicast", "reserved"]);

/**
 * Classify an IPv4/IPv6 literal STRING as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback (127/8, ::1,
 * IPv4-mapped ::ffff:127.x) ONLY — never RFC 1918 / link-local / metadata.
 *
 * Parsing + range classification + the embedded-v4 byte extraction are delegated to
 * `ipaddr.js`; the public-or-refused DECISION (the closed allowlists + the embedded-v4
 * re-check for IPv4-mapped/6to4/NAT64) is this module's reviewed policy.
 */
export function isPublicAddress(address: string, allowLoopback: boolean): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return false; // not a parseable IP literal → never public
  }
  if (addr.kind() === "ipv4") {
    return isPublicIpv4(addr as ipaddr.IPv4, allowLoopback);
  }
  return isPublicIpv6(addr as ipaddr.IPv6, allowLoopback);
}

function isPublicIpv4(addr: ipaddr.IPv4, allowLoopback: boolean): boolean {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}

function isPublicIpv6(addr: ipaddr.IPv6, allowLoopback: boolean): boolean {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  // IPv4-mapped (`::ffff:a.b.c.d`, in any textual form incl. the expanded hextet form
  // `0:0:0:0:0:ffff:HHHH:HHHH`) — classify per the EMBEDDED v4 so a mapped private/loopback
  // address (`::ffff:10.0.0.1`, `0:0:0:0:0:ffff:0a00:0001`) is refused, not waved through.
  if (range === "ipv4Mapped") {
    return isPublicIpv4(addr.toIPv4Address(), allowLoopback);
  }
  // 6to4 (`2002::/16`) embeds a v4 in bytes [2..5]; NAT64 well-known prefix (`64:ff9b::/96`,
  // `ipaddr.js` range `rfc6052`) embeds a v4 in the last 32 bits. A NAT'd 6to4 deployment or
  // a NAT64 gateway could otherwise tunnel/translate to an internal v4 — so block when the
  // embedded v4 is non-public (the embedded v4 is extracted from the canonical byte array).
  if (range === "6to4") {
    const v4 = embeddedV4(addr, 2);
    return v4 !== undefined && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  if (range === "rfc6052") {
    const v4 = embeddedV4(addr, 12);
    return v4 !== undefined && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  return PUBLIC_IPV6_RANGES.has(range);
}

/** Extract a 4-byte embedded IPv4 from an IPv6 address's canonical 16-byte array. */
function embeddedV4(addr: ipaddr.IPv6, startByte: number): ipaddr.IPv4 | undefined {
  const bytes = addr.toByteArray();
  if (bytes.length !== 16) {
    return undefined;
  }
  const v4Bytes = bytes.slice(startByte, startByte + 4);
  if (v4Bytes.length !== 4) {
    return undefined;
  }
  try {
    return new ipaddr.IPv4(v4Bytes);
  } catch {
    return undefined;
  }
}

function isPublicIpv4FromBytes(addr: ipaddr.IPv4, allowLoopback: boolean): boolean {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}

/**
 * Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). Used by the
 * HTTPS-dev override to refuse an `http:` URL whose host resolves to anything other than
 * loopback even when `allowLoopback=true` — a dev box must not HTTP-fetch a public host.
 */
export function isLoopbackAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv4") {
    return addr.range() === "loopback";
  }
  const v6 = addr as ipaddr.IPv6;
  if (v6.range() === "loopback") {
    return true;
  }
  if (v6.range() === "ipv4Mapped") {
    return v6.toIPv4Address().range() === "loopback";
  }
  return false;
}
