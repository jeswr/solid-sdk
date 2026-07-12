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
export declare function classifyIpLiteral(value: string): 0 | 4 | 6;
/**
 * Classify an IPv4/IPv6 literal STRING as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback (127/8, ::1,
 * IPv4-mapped ::ffff:127.x) ONLY — never RFC 1918 / link-local / metadata.
 *
 * Parsing + range classification + the embedded-v4 byte extraction are delegated to
 * `ipaddr.js`; the public-or-refused DECISION (the closed allowlists + the embedded-v4
 * re-check for IPv4-mapped/6to4/NAT64) is this module's reviewed policy.
 */
export declare function isPublicAddress(address: string, allowLoopback: boolean): boolean;
/**
 * Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). Used by the
 * HTTPS-dev override to refuse an `http:` URL whose host resolves to anything other than
 * loopback even when `allowLoopback=true` — a dev box must not HTTP-fetch a public host.
 */
export declare function isLoopbackAddress(address: string): boolean;
//# sourceMappingURL=addresses.d.ts.map