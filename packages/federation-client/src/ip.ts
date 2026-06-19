// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// IP-literal classification — the PURE, browser-safe SSRF primitive. Extracted from
// `./ssrf.ts` (which now re-exports the public entries) so the dense, RFC-spec'able
// address-range logic can be reviewed in isolation from the guard's fetch / redirect
// POLICY. This module has NO `node:` import, no `fetch`, no `globalThis` access, no
// I/O — every function is a total, synchronous predicate over a string. That makes it
// readable as a specification and keeps the #92 browser-safe guarantee local to one
// small file.
//
// `classifyIpLiteral` REPLACES `node:net#isIP` so the module imports no `node:` builtin
// (the #92 browser-safe mechanism). It returns the SAME values as `isIP` — `4` (IPv4),
// `6` (IPv6), `0` (not an IP literal) — and matches its STRICT semantics: canonical
// dotted-decimal IPv4 with no leading zeros / hex / extra octets, and canonical
// colon-hex IPv6 with at most one `::` and an optional embedded IPv4 in the last 32
// bits. The test suite fuzzes this against `node:net#isIP` over a large corpus to keep
// the two in lock-step; a divergence would weaken or over-tighten the SSRF
// classification, so it is treated as security-critical.
//
// The IP-classification ranges (`isPublicAddress` + helpers) are ported from the
// suite's vetted, exhaustively-tested `@pss/guarded-fetch` package (prod-solid-server
// `packages/guarded-fetch/src/addresses.ts`, itself ported from the RS WebID resolver).
// They are duplicated here (not depended on) only because `@pss/guarded-fetch` is an
// internal workspace package, not on npm; this client library ships standalone. The
// only deliberate divergence is the `node:net#isIP` dependency, replaced by the
// browser-safe `classifyIpLiteral` above. Keep the ranges in lock-step with the source.

// --- browser-safe IP-literal classification --------------------------------

/** Matches one canonical IPv4 dotted-decimal octet: 0, or 1–255 with no leading zero. */
const IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;

/**
 * Browser-safe equivalent of `node:net#isIP`. Returns `4` for a valid IPv4 literal,
 * `6` for a valid IPv6 literal, or `0` for anything else (a hostname, a malformed
 * literal, a bracketed literal, leading/trailing whitespace, …). Pure JS — no Node
 * builtin — so the module needs no polyfill in a browser bundle.
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
 * separated by `:`, at most ONE `::` compression, optional trailing embedded IPv4 in
 * the last 32 bits. Each non-embedded group is 1–4 hex digits. Rejects bracketed
 * forms, zone ids, double `::`, over-/under-length, and whitespace.
 */
function isIpv6Literal(value: string): boolean {
  // Match `node:net#isIP`'s acceptance of a scoped/zone id (`fe80::1%eth0`): the part
  // before `%` must be a valid IPv6 and the zone after `%` must be NON-EMPTY. Strip a
  // well-formed zone, then validate the address proper. (WHATWG `new URL` rejects a
  // bracketed zone-id host outright, so this only matters for the exported helpers
  // called with a raw address — keeping them in lock-step with `isIP`.) A `%` with an
  // empty zone, or a leading `%`, is NOT a valid literal.
  const pct = value.indexOf("%");
  if (pct !== -1) {
    const zone = value.slice(pct + 1);
    // The zone must be NON-EMPTY and contain no further `%` (matching `node:net#isIP`,
    // which rejects `fe80::1%` and `fe80::1%eth0%more`).
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

  // Split the (v4-stripped) core into groups around the optional "::".
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

// --- IP classification ------------------------------------------------------
// Ported from @pss/guarded-fetch (prod-solid-server
// packages/guarded-fetch/src/addresses.ts). See the module header for why it is
// duplicated rather than imported. Keep the RANGES in lock-step with the source; the
// only deliberate divergence is using the browser-safe `classifyIpLiteral` instead of
// `node:net#isIP` so the module imports no Node builtin (#92).

/**
 * Classify an IPv4/IPv6 literal as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback only.
 */
export function isPublicAddress(address: string, allowLoopback: boolean): boolean {
  const family = classifyIpLiteral(address);
  if (family === 4) {
    return isPublicIpv4(address, allowLoopback);
  }
  if (family === 6) {
    return isPublicIpv6(address, allowLoopback);
  }
  return false;
}

/** Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). */
export function isLoopbackAddress(address: string): boolean {
  const family = classifyIpLiteral(address);
  if (family === 4) {
    return address.startsWith("127.");
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
      return true;
    }
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      return classifyIpLiteral(v4) === 4 && v4.startsWith("127.");
    }
  }
  return false;
}

function isPublicIpv4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) {
    return false; // 0.0.0.0/8
  }
  if (a === 127) {
    return allowLoopback;
  }
  if (a === 10) {
    return false; // RFC 1918
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return false; // RFC 1918
  }
  if (a === 192 && b === 168) {
    return false; // RFC 1918
  }
  if (a === 169 && b === 254) {
    return false; // Link-local
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return false; // CGNAT 100.64.0.0/10
  }
  if (a >= 224 && a <= 239) {
    return false; // Multicast 224.0.0.0/4
  }
  if (a >= 240) {
    return false; // Reserved / broadcast
  }
  if (a === 192 && b === 0 && c === 2) {
    return false; // TEST-NET-1
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return false; // Benchmarking
  }
  if (a === 198 && b === 51 && c === 100) {
    return false; // TEST-NET-2
  }
  if (a === 203 && b === 0 && c === 113) {
    return false; // TEST-NET-3
  }
  return true;
}

/**
 * Pull the four IPv4 bytes from an IPv6 address starting at a given hextet pair index.
 * Used by the 6to4 + NAT64 checks to extract the embedded v4 and recurse through the
 * v4 classifier — preventing reaching an internal v4 via an IPv6-tunnelling prefix.
 */
function extractEmbeddedV4(hextets: string[], startHextet: number): string | undefined {
  const h1 = hextets[startHextet];
  const h2 = hextets[startHextet + 1];
  if (!h1 || !h2) {
    return undefined;
  }
  const w1 = Number.parseInt(h1, 16);
  const w2 = Number.parseInt(h2, 16);
  if (Number.isNaN(w1) || Number.isNaN(w2) || w1 < 0 || w1 > 0xffff || w2 < 0 || w2 > 0xffff) {
    return undefined;
  }
  return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`;
}

function isPublicIpv6(address: string, allowLoopback: boolean): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return allowLoopback;
  }
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") {
    return false; // Unspecified
  }
  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) — classify per the embedded v4. Detect via
  // FULL EXPANSION so both the compressed `::ffff:...` and the expanded
  // `0:0:0:0:0:ffff:HHHH:HHHH` forms are covered (a naive startsWith misses the latter,
  // letting `0:0:0:0:0:ffff:0a00:0001` = 10.0.0.1 pass as public).
  const mappedExpanded = expandIpv6(lower);
  if (
    mappedExpanded &&
    mappedExpanded[0] === "0" &&
    mappedExpanded[1] === "0" &&
    mappedExpanded[2] === "0" &&
    mappedExpanded[3] === "0" &&
    mappedExpanded[4] === "0" &&
    mappedExpanded[5] === "ffff"
  ) {
    const v4 = extractEmbeddedV4(mappedExpanded, 6);
    return v4 !== undefined && isPublicIpv4(v4, allowLoopback);
  }
  const head = lower.split(":")[0] ?? "";
  const high = Number.parseInt(head, 16);
  if (Number.isNaN(high)) {
    return false;
  }
  if ((high & 0xffc0) === 0xfe80) {
    return false; // fe80::/10 link-local
  }
  if ((high & 0xfe00) === 0xfc00) {
    return false; // fc00::/7 unique-local
  }
  if ((high & 0xff00) === 0xff00) {
    return false; // ff00::/8 multicast
  }
  if (high === 0x2002) {
    // 2002::/16 6to4 — encodes a v4 in hextets [1..2]. Block embedded non-public v4.
    const expanded = expandIpv6(lower);
    if (expanded) {
      const v4 = extractEmbeddedV4(expanded, 1);
      if (v4 && !isPublicIpv4(v4, allowLoopback)) {
        return false;
      }
    } else {
      return false; // fail closed
    }
  }
  if (high === 0x0064) {
    // 64:ff9b::/96 NAT64 well-known prefix (RFC 6052) — last 32 bits are a v4 address.
    const expanded = expandIpv6(lower);
    if (
      expanded &&
      expanded[0] === "64" &&
      expanded[1] === "ff9b" &&
      expanded[2] === "0" &&
      expanded[3] === "0" &&
      expanded[4] === "0" &&
      expanded[5] === "0"
    ) {
      const v4 = extractEmbeddedV4(expanded, 6);
      if (v4 && !isPublicIpv4(v4, allowLoopback)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Expand an IPv6 address to exactly 8 hextets so a classifier can index by position.
 * Returns lower-cased hextet strings (no leading zeros), or `undefined` if malformed.
 */
function expandIpv6(addr: string): string[] | undefined {
  let s = addr;
  const dot = s.lastIndexOf(".");
  if (dot !== -1) {
    const colon = s.lastIndexOf(":", dot);
    if (colon === -1) {
      return undefined;
    }
    const v4 = s.slice(colon + 1);
    if (classifyIpLiteral(v4) !== 4) {
      return undefined;
    }
    const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10));
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      return undefined;
    }
    s = `${s.slice(0, colon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const doubleColon = s.indexOf("::");
  let hextets: string[];
  if (doubleColon === -1) {
    hextets = s.split(":");
  } else {
    const head = s.slice(0, doubleColon) === "" ? [] : s.slice(0, doubleColon).split(":");
    const tail = s.slice(doubleColon + 2) === "" ? [] : s.slice(doubleColon + 2).split(":");
    const fill = 8 - head.length - tail.length;
    if (fill < 0) {
      return undefined;
    }
    hextets = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (hextets.length !== 8) {
    return undefined;
  }
  return hextets.map((h) => {
    const n = Number.parseInt(h, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) {
      return "BAD";
    }
    return n.toString(16);
  });
}
