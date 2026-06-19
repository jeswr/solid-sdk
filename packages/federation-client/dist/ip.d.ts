/**
 * Browser-safe equivalent of `node:net#isIP`. Returns `4` for a valid IPv4 literal,
 * `6` for a valid IPv6 literal, or `0` for anything else (a hostname, a malformed
 * literal, a bracketed literal, leading/trailing whitespace, …). Pure JS — no Node
 * builtin — so the module needs no polyfill in a browser bundle.
 */
export declare function classifyIpLiteral(value: string): 0 | 4 | 6;
/**
 * Classify an IPv4/IPv6 literal as public. Returns `false` for any non-public range,
 * malformed input, or a non-IP string. `allowLoopback` re-permits loopback only.
 */
export declare function isPublicAddress(address: string, allowLoopback: boolean): boolean;
/** Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). */
export declare function isLoopbackAddress(address: string): boolean;
//# sourceMappingURL=ip.d.ts.map