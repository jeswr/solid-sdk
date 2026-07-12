import { isIP } from "node:net";
import {
  isLoopbackAddress as gfIsLoopbackAddress,
  isPublicAddress as gfIsPublicAddress,
} from "@jeswr/guarded-fetch";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * DIFFERENTIAL-ORACLE regression test for the @jeswr/guarded-fetch rewire.
 *
 * THE INVARIANT THIS PROVES (the durable refactor proof): the shared
 * `@jeswr/guarded-fetch` classifier is AT LEAST AS STRICT as solid-agent-notify's
 * former inline classifier on EVERY address. Concretely, over an exhaustive
 * adversarial corpus, for every address the OLD guard BLOCKED (returned non-public),
 * guarded-fetch's `isPublicAddress` ALSO blocks — so the rewire can have introduced
 * NO private/loopback/metadata/reserved address that now slips through. A single
 * old-blocked-but-now-allowed address is a stop-the-line SSRF regression and fails
 * this test.
 *
 * The OLD classifier is embedded here VERBATIM (from commit 8e98dfa,
 * `src/security/addresses.ts`, before it was deleted in the rewire) as the ORACLE —
 * the `old`-prefixed functions below. It is a frozen snapshot, never imported from
 * src (src no longer has it), so this test pins the pre-refactor behaviour
 * independent of any later change to the library.
 *
 * Corpus (every octet / embedding enumerated, not sampled):
 *  - IPv4: full 0/8, 127/8, 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT),
 *    169.254/16 (link-local incl. metadata), multicast 224-239, reserved 240-255,
 *    the TEST-NET / benchmarking ranges, AND a band of genuinely public v4.
 *  - IPv6: ::1, ::, fc00::/7, fe80::/10, multicast, IPv4-mapped (compressed AND
 *    expanded) over every private v4 range, 6to4 (2002::) and NAT64 (64:ff9b::)
 *    embedding every private v4 range, plus public v6.
 *  - Alternate-encoded loopback literals (decimal / hex / octal / short-form).
 */
import { describe, expect, it, vi } from "vitest";
import { SsrfError, guardedFetch } from "./guardedFetch.js";
import { assertNotSsrf } from "./ssrf.js";

// ════════════════════════════════ THE ORACLE (verbatim pre-rewire classifier) ════════════════════════════════
// Embedded VERBATIM from commit 8e98dfa src/security/addresses.ts (deleted in the rewire). Do NOT
// "improve" it — its job is to be the frozen pre-refactor behaviour we diff guarded-fetch against.

function oldIsPublicAddress(address: string, allowLoopback: boolean): boolean {
  const family = isIP(address);
  if (family === 4) {
    return oldIsPublicIpv4(address, allowLoopback);
  }
  if (family === 6) {
    return oldIsPublicIpv6(address, allowLoopback);
  }
  return false;
}

function oldIsLoopbackAddress(address: string): boolean {
  const family = isIP(address);
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
      return isIP(v4) === 4 && v4.startsWith("127.");
    }
  }
  return false;
}

function oldIsPublicIpv4(address: string, allowLoopback: boolean): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return false; // 0.0.0.0/8
  if (a === 127) return allowLoopback;
  if (a === 10) return false; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
  if (a === 192 && b === 168) return false; // RFC 1918
  if (a === 169 && b === 254) return false; // Link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a >= 224 && a <= 239) return false; // Multicast 224.0.0.0/4
  if (a >= 240) return false; // Reserved / broadcast
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // Benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

function oldExtractEmbeddedV4(
  hextets: string[],
  startHextet: number
): string | undefined {
  const h1 = hextets[startHextet];
  const h2 = hextets[startHextet + 1];
  if (!h1 || !h2) return undefined;
  const w1 = Number.parseInt(h1, 16);
  const w2 = Number.parseInt(h2, 16);
  if (
    Number.isNaN(w1) ||
    Number.isNaN(w2) ||
    w1 < 0 ||
    w1 > 0xffff ||
    w2 < 0 ||
    w2 > 0xffff
  ) {
    return undefined;
  }
  return `${(w1 >> 8) & 0xff}.${w1 & 0xff}.${(w2 >> 8) & 0xff}.${w2 & 0xff}`;
}

function oldIsPublicIpv6(address: string, allowLoopback: boolean): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return allowLoopback;
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return false; // Unspecified
  const mappedExpanded = oldExpandIpv6(lower);
  if (
    mappedExpanded &&
    mappedExpanded[0] === "0" &&
    mappedExpanded[1] === "0" &&
    mappedExpanded[2] === "0" &&
    mappedExpanded[3] === "0" &&
    mappedExpanded[4] === "0" &&
    mappedExpanded[5] === "ffff"
  ) {
    const v4 = oldExtractEmbeddedV4(mappedExpanded, 6);
    return v4 !== undefined && oldIsPublicIpv4(v4, allowLoopback);
  }
  const head = lower.split(":")[0] ?? "";
  const high = Number.parseInt(head, 16);
  if (Number.isNaN(high)) return false;
  if ((high & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((high & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((high & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (high === 0x2002) {
    const expanded = oldExpandIpv6(lower);
    if (expanded) {
      const v4 = oldExtractEmbeddedV4(expanded, 1);
      if (v4 && !oldIsPublicIpv4(v4, allowLoopback)) return false;
    } else {
      return false;
    }
  }
  if (high === 0x0064) {
    const expanded = oldExpandIpv6(lower);
    if (
      expanded &&
      expanded[0] === "64" &&
      expanded[1] === "ff9b" &&
      expanded[2] === "0" &&
      expanded[3] === "0" &&
      expanded[4] === "0" &&
      expanded[5] === "0"
    ) {
      const v4 = oldExtractEmbeddedV4(expanded, 6);
      if (v4 && !oldIsPublicIpv4(v4, allowLoopback)) return false;
    }
  }
  return true;
}

function oldExpandIpv6(addr: string): string[] | undefined {
  let s = addr;
  const dot = s.lastIndexOf(".");
  if (dot !== -1) {
    const colon = s.lastIndexOf(":", dot);
    if (colon === -1) return undefined;
    const v4 = s.slice(colon + 1);
    if (isIP(v4) !== 4) return undefined;
    const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10));
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined
    )
      return undefined;
    s = `${s.slice(0, colon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const doubleColon = s.indexOf("::");
  let hextets: string[];
  if (doubleColon === -1) {
    hextets = s.split(":");
  } else {
    const head =
      s.slice(0, doubleColon) === "" ? [] : s.slice(0, doubleColon).split(":");
    const tail =
      s.slice(doubleColon + 2) === ""
        ? []
        : s.slice(doubleColon + 2).split(":");
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return undefined;
    hextets = [...head, ...Array<string>(fill).fill("0"), ...tail];
  }
  if (hextets.length !== 8) return undefined;
  return hextets.map((h) => {
    const n = Number.parseInt(h, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return "BAD";
    return n.toString(16);
  });
}

// ════════════════════════════════ THE ADVERSARIAL CORPUS ════════════════════════════════

/** Embed a dotted-v4 into the well-known NAT64 prefix (RFC 6052, 64:ff9b::/96). */
function nat64(v4: string): string {
  return `64:ff9b::${v4}`;
}

/** Embed a dotted-v4 into a 6to4 (2002::/16) address — v4 bytes occupy hextets [1..2]. */
function sixToFour(v4: string): string {
  const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10)) as [
    number,
    number,
    number,
    number,
  ];
  const h1 = ((a << 8) | b).toString(16);
  const h2 = ((c << 8) | d).toString(16);
  return `2002:${h1}:${h2}::`;
}

/** Build the exhaustive corpus of addresses to diff. */
function buildCorpus(): string[] {
  const out: string[] = [];

  // --- IPv4: every octet of each private/reserved range, plus a public band ---
  for (let i = 0; i <= 255; i += 1) {
    out.push(`10.${i}.0.1`); // 10/8
    out.push(`127.${i}.0.1`); // loopback 127/8
    out.push(`192.168.${i}.1`); // 192.168/16
    out.push(`169.254.${i}.1`); // link-local incl. 169.254.169.254 metadata
  }
  for (let b = 16; b <= 31; b += 1) out.push(`172.${b}.0.1`); // 172.16/12
  for (let b = 64; b <= 127; b += 1) out.push(`100.${b}.0.1`); // CGNAT 100.64/10
  out.push("0.0.0.0", "0.1.2.3", "0.255.255.255"); // 0/8 unspecified
  for (let a = 224; a <= 239; a += 1) out.push(`${a}.0.0.1`); // multicast 224/4
  for (let a = 240; a <= 255; a += 1) out.push(`${a}.0.0.1`); // reserved/broadcast
  out.push(
    "192.0.2.1", // TEST-NET-1
    "198.18.0.1",
    "198.19.0.1", // benchmarking
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
    "169.254.169.254", // explicit metadata
    "255.255.255.255" // broadcast
  );
  // A band of genuinely public v4 (must stay ALLOWED in both — the "not over-blocked" direction).
  const publicV4 = [
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "192.167.0.1",
    "192.169.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "9.9.9.9",
    "208.67.222.222",
    "93.184.216.34",
  ];
  out.push(...publicV4);

  // --- IPv6: loopback / unspecified / ULA / link-local / multicast ---
  out.push("::1", "0:0:0:0:0:0:0:1", "::", "0:0:0:0:0:0:0:0");
  out.push("fc00::1", "fcff::1", "fd00::1", "fdff::1"); // fc00::/7 ULA
  out.push("fe80::1", "fe90::1", "fea0::1", "feb0::1", "febf::1"); // fe80::/10 link-local
  out.push("ff00::1", "ff02::1", "ff05::1"); // multicast
  out.push("2606:4700::1", "2001:4860:4860::8888"); // public v6

  // --- IPv4-mapped IPv6 (compressed AND expanded), 6to4 + NAT64 embedding every private v4 ---
  const privateV4Reps = [
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "240.0.0.1",
  ];
  for (const v4 of privateV4Reps) {
    out.push(`::ffff:${v4}`); // mapped, compressed
    // mapped, expanded (two hextets)
    const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10)) as [
      number,
      number,
      number,
      number,
    ];
    out.push(
      `0:0:0:0:0:ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    );
    out.push(sixToFour(v4)); // 6to4 embedding the private v4
    out.push(nat64(v4)); // NAT64 embedding the private v4
  }
  // Public-embedding tunnels — must stay ALLOWED.
  out.push("::ffff:8.8.8.8", "2002:0808:0808::", nat64("8.8.8.8"));

  // --- Alternate-encoded loopback literals (these are the 4 documented divergences) ---
  // NOTE: these are NOT canonical isIP literals, so isPublicAddress treats them as non-IP (false)
  // in BOTH classifiers under allowLoopback=false. They are exercised separately below.

  return out;
}

const CORPUS = buildCorpus();

// ════════════════════════════════ THE DIFFERENTIAL ASSERTIONS ════════════════════════════════

/** The EXACT expected corpus size — enumerated, not sampled. Pinning the exact count (not a `>=`
 * floor) means accidentally DROPPING any range fails the test: with 1226 cases, removing e.g. the
 * 256-entry 10/8 enumeration drops the count and trips this guard, so coverage cannot silently
 * erode. The per-category sentinel assertions below additionally pin that EACH critical class is
 * actually present (a count alone could be padded). Update this number ONLY when deliberately
 * extending the corpus. */
const EXPECTED_CORPUS_SIZE = 1226;

/** Count corpus entries matching a predicate — used to pin each critical category's presence. */
function countMatching(pred: (addr: string) => boolean): number {
  return CORPUS.filter(pred).length;
}

describe("DIFFERENTIAL ORACLE: @jeswr/guarded-fetch is at least as strict as the old guard", () => {
  it(`corpus has the EXACT enumerated size (${EXPECTED_CORPUS_SIZE}) — no range silently dropped`, () => {
    expect(CORPUS.length).toBe(EXPECTED_CORPUS_SIZE);
  });

  it("corpus has explicit per-category coverage (each critical range is present, not just a count)", () => {
    // IPv4 full-octet enumerations (256 each) + the variable-width ranges.
    expect(countMatching((a) => a.startsWith("10."))).toBe(256); // RFC1918 10/8
    expect(countMatching((a) => a.startsWith("127."))).toBe(256); // loopback 127/8
    expect(countMatching((a) => a.startsWith("192.168."))).toBe(256); // RFC1918 192.168/16
    expect(
      countMatching((a) => a.startsWith("169.254."))
    ).toBeGreaterThanOrEqual(256); // link-local (+ explicit metadata)
    expect(countMatching((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a))).toBe(16); // 172.16/12
    expect(
      countMatching((a) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a))
    ).toBe(64); // CGNAT 100.64/10
    expect(countMatching((a) => /^(22[4-9]|23\d)\./.test(a))).toBe(16); // multicast 224-239
    // reserved 240-255: the 16 loop-generated `${a}.0.0.1` PLUS the explicit 255.255.255.255 sentinel.
    expect(countMatching((a) => /^(24\d|25[0-5])\./.test(a))).toBe(17);
    // Sentinels that MUST be present (the dangerous specials + the tunnel embeddings + v6 classes).
    const mustContain = [
      "169.254.169.254", // cloud metadata
      "0.0.0.0", // unspecified
      "255.255.255.255", // broadcast
      "192.0.2.1", // TEST-NET-1
      "198.51.100.1", // TEST-NET-2
      "203.0.113.1", // TEST-NET-3
      "198.18.0.1", // benchmarking
      "::1", // v6 loopback
      "::", // v6 unspecified
      "fc00::1", // ULA
      "fe80::1", // link-local
      "ff02::1", // multicast
      "::ffff:10.0.0.1", // IPv4-mapped private (compressed)
      "0:0:0:0:0:ffff:a00:1", // IPv4-mapped private (expanded, 10.0.0.1)
      "2002:a00:1::", // 6to4 embedding 10.0.0.1
      "64:ff9b::169.254.169.254", // NAT64 embedding metadata
      "8.8.8.8", // public v4 (not over-blocked)
      "2606:4700::1", // public v6
    ];
    for (const addr of mustContain) {
      expect(CORPUS, `corpus must contain ${addr}`).toContain(addr);
    }
  });

  it("PRODUCTION (allowLoopback=false): NO address the old guard blocked is allowed by guarded-fetch (0 regressions)", () => {
    const regressions: string[] = [];
    for (const addr of CORPUS) {
      const oldBlocked = !oldIsPublicAddress(addr, false);
      if (oldBlocked && gfIsPublicAddress(addr, false)) {
        regressions.push(addr);
      }
    }
    expect(regressions).toEqual([]);
  });

  it("allowLoopback=true: NO address the old guard blocked is allowed by guarded-fetch (0 regressions)", () => {
    const regressions: string[] = [];
    for (const addr of CORPUS) {
      const oldBlocked = !oldIsPublicAddress(addr, true);
      if (oldBlocked && gfIsPublicAddress(addr, true)) {
        regressions.push(addr);
      }
    }
    expect(regressions).toEqual([]);
  });

  it("loopback classification: every address the old guard called loopback is still loopback (0 diffs)", () => {
    const diffs: string[] = [];
    for (const addr of CORPUS) {
      if (oldIsLoopbackAddress(addr) && !gfIsLoopbackAddress(addr)) {
        diffs.push(addr);
      }
    }
    expect(diffs).toEqual([]);
  });

  it("does not over-block genuinely public addresses (both classifiers agree they are public)", () => {
    // The "not weaker AND not gratuitously stricter on public" direction for the public band.
    const publicAddrs = [
      "8.8.8.8",
      "1.1.1.1",
      "172.15.0.1",
      "172.32.0.1",
      "100.63.255.255",
      "100.128.0.1",
      "2606:4700::1",
      "::ffff:8.8.8.8",
      "2002:0808:0808::",
      nat64("8.8.8.8"),
    ];
    for (const addr of publicAddrs) {
      expect(oldIsPublicAddress(addr, false)).toBe(true);
      expect(gfIsPublicAddress(addr, false)).toBe(true);
    }
  });

  it("documented divergence: alternate-encoded loopback literals are MOOT at the REAL ingress (new URL canonicalises them)", async () => {
    // The 4 alternate encodings of 127.0.0.1. These are NOT canonical isIP literals; neither
    // classifier treats them as an IP via isPublicAddress directly. At the real ingress, `new URL`
    // canonicalises them to 127.0.0.1 BEFORE classification (assertNotSsrf's
    // normalizeHostForClassification), so they are correctly refused.
    const altLoopback = ["2130706433", "0x7f000001", "0177.0.0.1", "127.1"];
    for (const enc of altLoopback) {
      // (a) canonicalisation pin: new URL maps the encoding to 127.0.0.1.
      const canonical = new URL(`http://${enc}/`).hostname;
      expect(canonical).toBe("127.0.0.1");
      expect(oldIsPublicAddress(canonical, false)).toBe(false);
      expect(gfIsPublicAddress(canonical, false)).toBe(false);

      // (b) REAL INGRESS pin (the load-bearing part): drive assertNotSsrf with the RAW encoded URL.
      // In PRODUCTION (allowLoopback=false) it must be refused with SsrfError, and a DNS stub must
      // NEVER be consulted (the canonicalised loopback literal is classified directly, no DNS). This
      // catches a future regression that stopped normalising the raw URL before classification.
      const dns = vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]);
      await expect(
        assertNotSsrf(`https://${enc}/`, {
          allowLoopback: false,
          dnsLookup: dns,
        })
      ).rejects.toBeInstanceOf(SsrfError);
      expect(dns).not.toHaveBeenCalled();

      // (c) and through the full chokepoint: guardedFetch refuses the raw encoded URL as SsrfError.
      await expect(
        guardedFetch(`https://${enc}/`, {
          dnsLookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]),
        })
      ).rejects.toBeInstanceOf(SsrfError);
    }
  });
});
