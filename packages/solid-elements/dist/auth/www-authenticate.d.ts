/**
 * Parse a `WWW-Authenticate` header into its individual challenges, each with its scheme
 * and a QUOTE-AWARE map of its top-level auth-params. PURE + exported for testing.
 *
 * The grammar (RFC 9110 §11.6.1) is comma-ambiguous: commas separate BOTH auth-params
 * within a challenge AND challenges from each other; auth-params allow optional whitespace
 * around `=` (BWS); and a quoted value may itself contain commas/`=`/scheme-like words. We
 * tokenise character-by-character into atoms (a bare word, a quoted string, or a standalone
 * `=`), then walk those atoms into challenges (see the internal `tokenizeChallengeHeader`
 * and `walkChallengeAtoms` helpers). Param VALUES are unquoted (quotes stripped, escapes
 * resolved). Odd input degrades safely (the caller is conservative — only an UNAMBIGUOUS
 * DPoP `error="use_dpop_nonce"` is acted on).
 *
 * The return type is written as the INLINE structural shape (not the internal `Challenge`
 * alias) so the published `.d.ts` — and the api-extractor report — stay byte-identical to
 * the pre-refactor signature: this decomposition changes structure, never the contract.
 */
export declare function parseWwwAuthenticate(header: string): {
    scheme: string;
    params: Map<string, string>;
}[];
/**
 * Whether a 401 response is a PURE DPoP-nonce challenge — i.e. its `WWW-Authenticate`
 * carries the DPoP scheme with `error="use_dpop_nonce"` (RFC 9449 §8). PURE + exported
 * for testing.
 *
 * This is deliberately CONSERVATIVE: it returns true ONLY when the server explicitly
 * says the token was fine and only the nonce was missing. Any OTHER error (e.g.
 * `invalid_token`, expired/revoked) — or no DPoP `error` token at all — returns false,
 * so the caller force-refreshes the access token instead of looping on a stale one even
 * when the server ALSO rotated the `DPoP-Nonce`. We match the `DPoP` auth-scheme
 * challenge specifically; a `Bearer …` challenge that happens to mention the string is
 * not treated as a DPoP nonce challenge.
 */
export declare function isUseDpopNonceChallenge(response: Response): boolean;
