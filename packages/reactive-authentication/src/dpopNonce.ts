import * as oauth from "oauth4webapi";

/**
 * Runs a token endpoint request (request and response processing) and retries it exactly once when the
 * server demands a fresh DPoP nonce (RFC 9449 §8). The same oauth4webapi DPoP handle must be used by both
 * attempts: it remembers the nonce. A nonce rejection happens before the grant is consumed, so retrying a
 * refresh grant cannot reuse a rotated refresh token.
 */
export async function withDPoPNonceRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (e) {
    if (!oauth.isDPoPNonceError(e)) throw e;
    return await attempt();
  }
}

/** Picks a DPoP signing algorithm the server supports (ES256 preferred) and generates a non-extractable key. */
export async function generateDPoPKey(as: oauth.AuthorizationServer): Promise<CryptoKeyPair> {
  const supported = as.dpop_signing_alg_values_supported;
  const preferred = ["ES256", "EdDSA", "PS256", "RS256"];
  const alg = supported === undefined ? "ES256" : preferred.find((a) => supported.includes(a));
  if (alg === undefined)
    throw new Error(`No supported DPoP signing algorithm among ${supported!.join(", ")}`);
  return await oauth.generateKeyPair(alg, { extractable: false });
}
