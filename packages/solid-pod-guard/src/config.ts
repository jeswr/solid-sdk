// AUTHORED-BY Claude Fable 5
/**
 * Guard configuration. EVERYTHING here fails closed: an unset
 * allowlist disables the rail (503) rather than opening it.
 *
 * Extracted verbatim from the reviewed reference implementation (config
 * renamed only: its app-specific config type became {@link PodGuardConfig},
 * its pod allowlist field became `allowedPodOrigins`, and its hardcoded env
 * names became `${envPrefix}_*`; use-case-specific issuer lists stayed with
 * the reference app).
 *
 * SECURITY: `allowInsecureLoopback` exists ONLY for the local dev/e2e loop
 * (loopback-HTTP dev issuer + in-memory pods). It relaxes transport rules
 * (http on loopback, plain fetch for WebID dereferencing instead of the
 * DNS-pinned SSRF-guarded default). It NEVER relaxes any verification gate:
 * token verification, the pim:storage binding, and every fail-closed check
 * run identically.
 */

export interface PodGuardConfig {
  /** Solid-OIDC issuers trusted to mint caller access tokens (L1). */
  readonly trustedOidcIssuers: readonly string[];
  /** Pod ORIGINS the server-side pod reads/writes may touch (SSRF allowlist). */
  readonly allowedPodOrigins: readonly string[];
  /** Dev/e2e only — see the module header. */
  readonly allowInsecureLoopback?: boolean;
  /** Trust X-Forwarded-* for htu reconstruction (TLS-terminating proxy only). */
  readonly trustForwardedHeaders?: boolean;
}

function splitList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Read the config from the environment under an app-chosen prefix, e.g.
 * `configFromEnv("MYAPP")` reads `MYAPP_TRUSTED_OIDC_ISSUERS`,
 * `MYAPP_POD_ALLOWED_ORIGINS`, `MYAPP_DEV_ALLOW_LOOPBACK`, and
 * `MYAPP_TRUST_FORWARDED_HEADERS`.
 */
export function configFromEnv(
  envPrefix: string,
  env: NodeJS.ProcessEnv = process.env,
): PodGuardConfig {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(envPrefix)) {
    throw new Error(
      `envPrefix must be a non-empty UPPER_SNAKE env-var prefix, got ${JSON.stringify(envPrefix)}`,
    );
  }
  return {
    trustedOidcIssuers: splitList(env[`${envPrefix}_TRUSTED_OIDC_ISSUERS`]),
    allowedPodOrigins: splitList(env[`${envPrefix}_POD_ALLOWED_ORIGINS`]),
    allowInsecureLoopback: env[`${envPrefix}_DEV_ALLOW_LOOPBACK`] === "1",
    // Vercel terminates TLS ahead of the function, so the forwarded headers are
    // authoritative there; anywhere else they are attacker-controlled (default off).
    trustForwardedHeaders:
      env.VERCEL === "1" || env[`${envPrefix}_TRUST_FORWARDED_HEADERS`] === "1",
  };
}

/** Standard "rail not configured" fail-closed response. */
export function notConfigured(detail: string): Response {
  return Response.json(
    {
      simulated: true,
      error: "not_configured",
      detail: `${detail} — this rail fails closed until an operator configures it`,
    },
    { status: 503 },
  );
}
