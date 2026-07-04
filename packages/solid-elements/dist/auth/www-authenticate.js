// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements/auth — the RFC 9110 §11.6.1 `WWW-Authenticate` challenge
// parser + the RFC 9449 §8 pure-nonce predicate.
//
// PURE CORE (no `fetch`/`globalThis`/DOM state — only a `Response` header read): a
// character-level tokeniser + a challenge walker, extracted out of the stateful auth
// controller so this security-sensitive parse can be reviewed AS A SPEC in isolation.
// Exhaustively pinned by `test/characterization.test.ts` (imports through the
// `./index.js` barrel, which re-exports the two public functions here unchanged).
/**
 * Tokenise a `WWW-Authenticate` header into {@link ChallengeAtom}s. Whitespace + commas
 * separate atoms (commas are not otherwise significant — challenge boundaries are inferred
 * later from the word-not-followed-by-`=` rule, which is robust to the RFC 9110 §11.6.1
 * comma ambiguity). A quoted string is ALWAYS a value atom (even abutting a bare word) and
 * may contain commas/`=`/scheme-like words; `\`-escapes inside it are resolved.
 */
/** Characters that separate atoms outside a quoted string (commas + linear whitespace). */
const CHALLENGE_ATOM_SEPARATORS = new Set([",", " ", "\t"]);
function tokenizeChallengeHeader(header) {
    const atoms = [];
    let buf = "";
    let bufIsQuoted = false;
    let inQuotes = false;
    const flush = () => {
        if (buf || bufIsQuoted) {
            atoms.push({ kind: bufIsQuoted ? "quoted" : "word", text: buf });
            buf = "";
            bufIsQuoted = false;
        }
    };
    for (let i = 0; i < header.length; i++) {
        const c = header[i];
        // ── Inside a quoted string: resolve `\`-escapes, end on the closing `"`. ──
        if (inQuotes) {
            if (c === "\\" && i + 1 < header.length) {
                buf += header[++i]; // escaped char — take the NEXT char literally
            }
            else if (c === '"') {
                inQuotes = false; // closing quote
            }
            else {
                buf += c;
            }
            continue;
        }
        // ── Outside quotes: `"` opens a (value) atom, `=` is its own atom, separators flush. ──
        if (c === '"') {
            flush(); // a quoted string is ALWAYS a value atom; flush any pending bare word first
            inQuotes = true;
            bufIsQuoted = true;
        }
        else if (c === "=") {
            flush();
            atoms.push({ kind: "eq" });
        }
        else if (CHALLENGE_ATOM_SEPARATORS.has(c)) {
            flush();
        }
        else {
            buf += c;
        }
    }
    flush();
    return atoms;
}
/**
 * Walk tokenised {@link ChallengeAtom}s into {@link Challenge}s. A `word [=] value` triple
 * (tolerating the BWS `eq` atom) is an auth-param attributed to the CURRENT challenge; a
 * lone word NOT followed by `=` starts a NEW challenge (a scheme / token68). Param keys are
 * lower-cased. A stray `eq`, or a quoted/param atom with no preceding scheme, is dropped.
 */
function walkChallengeAtoms(atoms) {
    const challenges = [];
    for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i];
        // Only a bare WORD can begin a challenge or a param key; a stray `=` or a dangling
        // quoted value (no `key =` before it) is not a valid challenge/param — skip it.
        if (atom.kind !== "word")
            continue;
        // A WORD is an auth-param key iff the NEXT atom is `=`; else it is a new scheme.
        if (atoms[i + 1]?.kind !== "eq") {
            challenges.push({ scheme: atom.text, params: new Map() });
            continue;
        }
        const valueAtom = atoms[i + 2];
        const value = valueAtom && valueAtom.kind !== "eq" ? valueAtom.text : "";
        // Index the last challenge directly (NOT `.at(-1)`) to match the pre-refactor
        // runtime floor — `Array.prototype.at` is newer than plain index access, and the
        // `?.` already no-ops the "param before any scheme" case the original guarded.
        challenges[challenges.length - 1]?.params.set(atom.text.toLowerCase(), value);
        i += 2; // consume `= value`
    }
    return challenges;
}
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
export function parseWwwAuthenticate(header) {
    return walkChallengeAtoms(tokenizeChallengeHeader(header));
}
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
export function isUseDpopNonceChallenge(response) {
    const header = response.headers.get("WWW-Authenticate");
    if (!header)
        return false;
    // A `WWW-Authenticate` value can carry MULTIPLE challenges (RFC 9110 §11.6.1), e.g.
    // `Bearer error="invalid_token", DPoP error="use_dpop_nonce"`, and even MULTIPLE DPoP
    // challenges. We inspect ONLY the TOP-LEVEL `error` auth-param of the `DPoP` challenges —
    // reading `error=` from another scheme's challenge, or from INSIDE a quoted value, would
    // wrongly classify a DPoP `invalid_token` as a pure nonce challenge.
    //
    // UNAMBIGUOUS-NONCE rule (the roborev finding): return true only when the DPoP challenge
    // set is nonce-ONLY — at least one DPoP challenge says `use_dpop_nonce` AND no DPoP
    // challenge reports a DIFFERENT error. If ANY DPoP challenge carries a non-nonce error
    // (invalid_token / expired / revoked), the token may be stale, so we must NOT skip the
    // forced refresh — return false (force-refresh) even if another DPoP challenge mentions a
    // nonce.
    let sawNonce = false;
    for (const challenge of parseWwwAuthenticate(header)) {
        if (challenge.scheme.toLowerCase() !== "dpop")
            continue;
        const error = challenge.params.get("error")?.toLowerCase();
        if (error === undefined)
            continue; // a DPoP challenge with no error is not a signal
        if (error === "use_dpop_nonce")
            sawNonce = true;
        else
            return false; // a DPoP challenge with a DIFFERENT error → ambiguous → force refresh
    }
    return sawNonce;
}
