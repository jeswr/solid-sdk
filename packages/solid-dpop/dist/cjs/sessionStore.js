"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeSession = serializeSession;
exports.deserializeSession = deserializeSession;
exports.saveSession = saveSession;
exports.loadSession = loadSession;
/**
 * Persist a user-delegated {@link AuthCodeSession} to disk so a CLI can log in ONCE and have
 * later invocations (pull/push/watch, a gateway restart, a re-run of an importer) reuse the
 * session via the refresh grant — no second browser round-trip.
 *
 * ───────────────────────────── WHY THE PRIVATE KEY IS PERSISTED ─────────────────────────────
 * CSS (node-oidc-provider) binds the refresh token to the original DPoP `jkt`: a refresh request
 * signed by a DIFFERENT keypair is rejected with `invalid_grant` (verified live against CSS v8 —
 * a fresh keypair fails, the original succeeds). So we CANNOT regenerate the keypair per process;
 * the DPoP private key MUST be stored alongside the refresh token. It is exported as a private
 * JWK (see {@link exportDpopKeyPairJwk}) and the file is written `0600` (owner-only) to limit the
 * blast radius — the same posture as an SSH private key or a `~/.npmrc` token.
 *
 * The stored file is NOT a bearer credential on its own: the access token is short-lived and the
 * refresh token is DPoP-bound, so possession of the file additionally requires the co-stored
 * private key to be usable. Still: it grants the holder the user's pod access until the refresh
 * token is revoked. Treat it like any other long-lived secret; `0600` is the floor, not a
 * substitute for OS-level disk protection.
 */
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const dpop_js_1 = require("./dpop.js");
/** Bump when the on-disk shape changes incompatibly. */
const STORE_VERSION = 1;
/** Serialise a live session to its on-disk JSON shape (keypair exported as a private JWK). */
async function serializeSession(session) {
    const keyPairJwk = await (0, dpop_js_1.exportDpopKeyPairJwk)(session.keyPair);
    return {
        version: STORE_VERSION,
        keyPairJwk,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        client: session.client,
        providerMetadata: session.providerMetadata,
        ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
        ...(session.nonce ? { nonce: session.nonce } : {}),
    };
}
/** Reconstruct a live {@link AuthCodeSession} (keypair rebuilt from the stored private JWK). */
async function deserializeSession(stored) {
    if (stored.version !== STORE_VERSION) {
        throw new Error(`Unsupported session store version ${stored.version} (expected ${STORE_VERSION}).`);
    }
    const keyPair = await (0, dpop_js_1.importDpopKeyPairJwk)(stored.keyPairJwk);
    return {
        keyPair,
        accessToken: stored.accessToken,
        expiresAt: stored.expiresAt,
        client: stored.client,
        providerMetadata: stored.providerMetadata,
        ...(stored.refreshToken ? { refreshToken: stored.refreshToken } : {}),
        ...(stored.nonce ? { nonce: stored.nonce } : {}),
    };
}
/**
 * Persist a session to `path` as `0600` JSON. Creates the parent directory if needed. The chmod is
 * applied AFTER the write (and the write opens with mode `0600`) so the secret is never briefly
 * world-readable.
 */
async function saveSession(path, session) {
    const stored = await serializeSession(session);
    await (0, promises_1.mkdir)((0, node_path_1.dirname)(path), { recursive: true });
    await (0, promises_1.writeFile)(path, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
    // Ensure 0600 even if the file pre-existed with looser perms (writeFile mode only applies on create).
    await (0, promises_1.chmod)(path, 0o600);
}
/** Load a persisted session from `path`, or `undefined` if the file does not exist. Throws on corruption. */
async function loadSession(path) {
    let raw;
    try {
        raw = await (0, promises_1.readFile)(path, "utf8");
    }
    catch (e) {
        if (e.code === "ENOENT")
            return undefined;
        throw e;
    }
    const stored = JSON.parse(raw);
    return deserializeSession(stored);
}
//# sourceMappingURL=sessionStore.js.map