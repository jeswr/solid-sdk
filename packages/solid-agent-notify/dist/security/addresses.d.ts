/**
 * Classify an IPv4/IPv6 literal as public. Returns `false` for any non-public range, malformed
 * input, or a non-IP string. `allowLoopback` re-permits loopback (127/8, ::1, mapped 127.x) only.
 */
export declare function isPublicAddress(address: string, allowLoopback: boolean): boolean;
/**
 * Whether `address` is loopback (127/8, ::1, or IPv4-mapped ::ffff:127.x.x.x). Used by the HTTPS
 * dev override to refuse `http:` URLs whose host resolves to anything other than loopback even when
 * `allowLoopback=true` — a dev box must not HTTP-fetch a public host.
 */
export declare function isLoopbackAddress(address: string): boolean;
//# sourceMappingURL=addresses.d.ts.map