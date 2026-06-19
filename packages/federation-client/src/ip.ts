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
  const withoutZone = stripIpv6Zone(value);
  if (withoutZone === undefined) {
    return false; // malformed zone id (empty / doubled `%`)
  }
  if (withoutZone.length === 0 || /[^0-9a-fA-F:.]/.test(withoutZone)) {
    return false; // empty, or a character outside the IPv6 alphabet
  }
  // At most one "::" compression marker.
  if ((withoutZone.match(/::/g)?.length ?? 0) > 1) {
    return false;
  }
  // A trailing embedded IPv4 (e.g. `::ffff:1.2.3.4`) fills the last two hextets.
  const stripped = stripEmbeddedV4(withoutZone);
  if (stripped === undefined) {
    return false; // a `.` present but not a valid trailing-IPv4 suffix
  }
  return validateHextetGroups(
    stripped.core,
    8 - stripped.embeddedV4Groups,
    stripped.embeddedV4Groups > 0,
  );
}

/**
 * Strip a scoped/zone id (`fe80::1%eth0`), returning the address part before `%`, or the
 * input unchanged when there is no `%`. Returns `undefined` for a MALFORMED zone — an
 * empty zone (`fe80::1%`) or a doubled `%` (`fe80::1%eth0%more`) — matching
 * `node:net#isIP`. (WHATWG `new URL` rejects a bracketed zone-id host outright, so this
 * only matters for the exported helpers called with a raw address.)
 */
function stripIpv6Zone(value: string): string | undefined {
  const pct = value.indexOf("%");
  if (pct === -1) {
    return value;
  }
  const zone = value.slice(pct + 1);
  if (zone.length === 0 || zone.includes("%")) {
    return undefined;
  }
  return value.slice(0, pct);
}

/**
 * Recognise + strip a trailing embedded IPv4 suffix (the `a.b.c.d` after the final
 * colon). Returns the colon-`core` to validate as hextet groups plus how many of the 8
 * groups the embedded v4 consumes (2 when present, 0 otherwise). Returns `undefined`
 * when a `.` is present but the suffix is NOT a valid trailing IPv4 (so the whole
 * literal is rejected). The returned `core` keeps the trailing `:` so the group-split is
 * uniform with the no-embedded-v4 case.
 */
function stripEmbeddedV4(value: string): { core: string; embeddedV4Groups: number } | undefined {
  const dot = value.indexOf(".");
  if (dot === -1) {
    return { core: value, embeddedV4Groups: 0 };
  }
  const lastColon = value.lastIndexOf(":");
  if (lastColon === -1 || lastColon > dot) {
    return undefined; // the dotted part is not the suffix after the final colon
  }
  if (!isIpv4Literal(value.slice(lastColon + 1))) {
    return undefined;
  }
  return { core: value.slice(0, lastColon + 1), embeddedV4Groups: 2 };
}

/**
 * Validate the colon-separated hextet `core` (already stripped of any embedded v4 and
 * zone) against the required group count. Handles the compressed (`::`) and
 * uncompressed forms: with `::` the head+tail groups must be valid hextets and number
 * STRICTLY FEWER than `requiredGroups` (the `::` stands in for ≥1 zero group); without
 * `::` there must be EXACTLY `requiredGroups` valid hextets.
 *
 * `hadEmbeddedV4` reproduces the original's exact trailing-`:` handling: a `core` ending
 * in `:` is only the legitimate separator left BY an embedded-v4 strip, so the trailing
 * empty token is dropped ONLY then. Without an embedded v4, a trailing `:` is a genuine
 * malformed group and is left in place (so it fails as an empty hextet / wrong count) —
 * dropping it unconditionally would wrongly ACCEPT e.g. `1:2:3:4:5:6:7:8:`.
 */
function validateHextetGroups(
  core: string,
  requiredGroups: number,
  hadEmbeddedV4: boolean,
): boolean {
  const compressionIdx = core.indexOf("::");
  if (compressionIdx !== -1) {
    const head = splitHextets(core.slice(0, compressionIdx));
    let tailStr = core.slice(compressionIdx + 2);
    if (hadEmbeddedV4 && tailStr.endsWith(":")) {
      tailStr = tailStr.slice(0, -1);
    }
    const tail = splitHextets(tailStr);
    if (!head.every(isHextet) || !tail.every(isHextet)) {
      return false;
    }
    // "::" must stand in for AT LEAST ONE zero group, so head+tail must be < required.
    return head.length + tail.length < requiredGroups;
  }
  let groupsStr = core;
  if (hadEmbeddedV4 && groupsStr.endsWith(":")) {
    groupsStr = groupsStr.slice(0, -1);
  }
  const groups = splitHextets(groupsStr);
  return groups.length === requiredGroups && groups.every(isHextet);
}

/** Split a colon-joined hextet run, treating the empty string as zero groups. */
function splitHextets(s: string): string[] {
  return s === "" ? [] : s.split(":");
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

/**
 * The non-public IPv4 ranges — the SSRF block-list, as a reviewable data table of
 * `(label, matches)` predicates over the four octets. A literal whose octets match ANY
 * entry is refused. This is the same set the previous if-ladder enforced (loopback
 * 127/8 is handled separately by {@link isPublicIpv4} because it is re-permittable under
 * `allowLoopback`); expressing it as a table lets a reviewer read the block-list as a
 * list rather than tracing branch flow. Keep in lock-step with `@pss/guarded-fetch`.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<{
  readonly label: string;
  readonly matches: (a: number, b: number, c: number) => boolean;
}> = [
  { label: "0.0.0.0/8", matches: (a) => a === 0 },
  { label: "RFC1918 10.0.0.0/8", matches: (a) => a === 10 },
  { label: "RFC1918 172.16.0.0/12", matches: (a, b) => a === 172 && b >= 16 && b <= 31 },
  { label: "RFC1918 192.168.0.0/16", matches: (a, b) => a === 192 && b === 168 },
  { label: "link-local 169.254.0.0/16", matches: (a, b) => a === 169 && b === 254 },
  { label: "CGNAT 100.64.0.0/10", matches: (a, b) => a === 100 && b >= 64 && b <= 127 },
  { label: "multicast 224.0.0.0/4", matches: (a) => a >= 224 && a <= 239 },
  { label: "reserved/broadcast 240.0.0.0/4", matches: (a) => a >= 240 },
  { label: "TEST-NET-1 192.0.2.0/24", matches: (a, b, c) => a === 192 && b === 0 && c === 2 },
  { label: "benchmarking 198.18.0.0/15", matches: (a, b) => a === 198 && (b === 18 || b === 19) },
  { label: "TEST-NET-2 198.51.100.0/24", matches: (a, b, c) => a === 198 && b === 51 && c === 100 },
  { label: "TEST-NET-3 203.0.113.0/24", matches: (a, b, c) => a === 203 && b === 0 && c === 113 },
];

function isPublicIpv4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  // Loopback 127/8 is the one range a caller may re-permit (dev `allowLoopback`); every
  // other non-public range is an unconditional refusal.
  if (a === 127) {
    return allowLoopback;
  }
  if (BLOCKED_IPV4_RANGES.some((range) => range.matches(a, b, c))) {
    return false;
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

/**
 * Whether the expanded hextets begin with the given literal-hextet prefix (each a
 * lower-case no-leading-zero hextet string, exactly as {@link expandIpv6} emits). Used
 * to recognise the IPv4-mapped / NAT64 prefixes positionally.
 */
function hextetsMatchPrefix(hextets: string[], prefix: readonly string[]): boolean {
  return prefix.every((value, i) => hextets[i] === value);
}

/**
 * The non-public IPv6 "high hextet" masks — link-local / ULA / multicast — keyed on the
 * FIRST hextet's value masked by `mask`. A literal whose high hextet matches ANY entry
 * is refused. (Loopback, unspecified, IPv4-mapped, 6to4 and NAT64 are handled out of
 * band in {@link isPublicIpv6} because they need the embedded-v4 recursion or are
 * re-permittable.) Keep in lock-step with `@pss/guarded-fetch`.
 */
const BLOCKED_IPV6_HIGH_MASKS: ReadonlyArray<{
  readonly label: string;
  readonly mask: number;
  readonly value: number;
}> = [
  { label: "fe80::/10 link-local", mask: 0xffc0, value: 0xfe80 },
  { label: "fc00::/7 unique-local", mask: 0xfe00, value: 0xfc00 },
  { label: "ff00::/8 multicast", mask: 0xff00, value: 0xff00 },
];

/**
 * Whether the v4 embedded at `startHextet` is present AND PUBLIC. Used for the
 * IPv4-mapped case, where a v4 that cannot be extracted is treated as NON-public
 * (fail closed): `false` ⇒ refuse.
 */
function embeddedV4IsPublic(
  hextets: string[],
  startHextet: number,
  allowLoopback: boolean,
): boolean {
  const v4 = extractEmbeddedV4(hextets, startHextet);
  return v4 !== undefined && isPublicIpv4(v4, allowLoopback);
}

/**
 * Whether the v4 embedded at `startHextet` is present AND NON-public — the refusal
 * condition for an IPv6 TUNNELLING prefix (6to4 / NAT64). NOTE the deliberate asymmetry
 * vs {@link embeddedV4IsPublic}: when the embedded v4 cannot be extracted this returns
 * `false` (do NOT refuse), exactly matching the original tunnelling branches' `if (v4 &&
 * !isPublicIpv4(v4)) refuse` — an unextractable tunnel suffix is left to fall through,
 * not blocked. (The 6to4 branch separately fails closed when expansion ITSELF fails.)
 */
function embeddedTunnelV4IsBlocked(
  hextets: string[],
  startHextet: number,
  allowLoopback: boolean,
): boolean {
  const v4 = extractEmbeddedV4(hextets, startHextet);
  return v4 !== undefined && !isPublicIpv4(v4, allowLoopback);
}

function isPublicIpv6(address: string, allowLoopback: boolean): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return allowLoopback; // loopback — re-permittable
  }
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") {
    return false; // Unspecified
  }

  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) — classify per the embedded v4. Detect via FULL
  // EXPANSION so both the compressed `::ffff:...` and the expanded
  // `0:0:0:0:0:ffff:HHHH:HHHH` forms are covered (a naive startsWith misses the latter,
  // letting `0:0:0:0:0:ffff:0a00:0001` = 10.0.0.1 pass as public).
  const expanded = expandIpv6(lower);
  if (expanded && hextetsMatchPrefix(expanded, ["0", "0", "0", "0", "0", "ffff"])) {
    return embeddedV4IsPublic(expanded, 6, allowLoopback);
  }

  // Link-local / ULA / multicast — a high-hextet bitmask block-list.
  const head = lower.split(":")[0] ?? "";
  const high = Number.parseInt(head, 16);
  if (Number.isNaN(high)) {
    return false;
  }
  if (BLOCKED_IPV6_HIGH_MASKS.some((m) => (high & m.mask) === m.value)) {
    return false;
  }

  // 6to4 / NAT64 tunnelling prefixes that smuggle a v4 — refuse a non-public embedded v4.
  if (tunnellingPrefixIsBlocked(high, expanded, allowLoopback)) {
    return false;
  }

  return true;
}

/**
 * Whether an IPv6 TUNNELLING prefix that embeds an IPv4 address must be refused:
 *   - `2002::/16` 6to4 — the v4 is in hextets [1..2]; refuse a non-public embedded v4,
 *     and FAIL CLOSED when the address cannot be expanded at all;
 *   - `64:ff9b::/96` NAT64 (RFC 6052) — the v4 is the last 32 bits; refuse a non-public
 *     embedded v4.
 * `false` for any non-tunnelling `high` (the address is then judged by the other rules).
 */
function tunnellingPrefixIsBlocked(
  high: number,
  expanded: string[] | undefined,
  allowLoopback: boolean,
): boolean {
  if (high === 0x2002) {
    // 6to4 fails closed if it cannot be expanded; else refuse a non-public embedded v4.
    return !expanded || embeddedTunnelV4IsBlocked(expanded, 1, allowLoopback);
  }
  if (high === 0x0064) {
    return (
      expanded !== undefined &&
      hextetsMatchPrefix(expanded, ["64", "ff9b", "0", "0", "0", "0"]) &&
      embeddedTunnelV4IsBlocked(expanded, 6, allowLoopback)
    );
  }
  return false;
}

/**
 * Expand an IPv6 address to exactly 8 hextets so a classifier can index by position.
 * Returns lower-cased hextet strings (no leading zeros), or `undefined` if malformed.
 */
function expandIpv6(addr: string): string[] | undefined {
  const folded = foldTrailingV4ToHextets(addr);
  if (folded === undefined) {
    return undefined; // a trailing `.` that is not a valid embedded IPv4
  }
  const hextets = splitAndFillHextets(folded);
  if (hextets === undefined || hextets.length !== 8) {
    return undefined;
  }
  return hextets.map(normalizeHextet);
}

/**
 * Fold a trailing embedded IPv4 (`…:a.b.c.d`) into two colon-joined hextets so the rest
 * of {@link expandIpv6} sees a pure colon-hex string. Returns the input unchanged when
 * there is no `.`; `undefined` when a `.` is present but the suffix is not a valid
 * trailing IPv4.
 */
function foldTrailingV4ToHextets(addr: string): string | undefined {
  const dot = addr.lastIndexOf(".");
  if (dot === -1) {
    return addr;
  }
  const colon = addr.lastIndexOf(":", dot);
  if (colon === -1) {
    return undefined;
  }
  const v4 = addr.slice(colon + 1);
  if (classifyIpLiteral(v4) !== 4) {
    return undefined;
  }
  const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10));
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return undefined;
  }
  return `${addr.slice(0, colon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

/**
 * Split a pure colon-hex IPv6 string into hextet tokens, expanding a single `::` to the
 * zero groups it stands for. Returns the token array (NOT yet length-checked or
 * normalised), or `undefined` when the `::` fill would be negative (too many groups).
 */
function splitAndFillHextets(s: string): string[] | undefined {
  const doubleColon = s.indexOf("::");
  if (doubleColon === -1) {
    return s.split(":");
  }
  const head = splitHextets(s.slice(0, doubleColon));
  const tail = splitHextets(s.slice(doubleColon + 2));
  const fill = 8 - head.length - tail.length;
  if (fill < 0) {
    return undefined;
  }
  return [...head, ...Array<string>(fill).fill("0"), ...tail];
}

/** Normalise one hextet to its lower-case no-leading-zero hex value, or `"BAD"` if out of range. */
function normalizeHextet(h: string): string {
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n) || n < 0 || n > 0xffff) {
    return "BAD";
  }
  return n.toString(16);
}
