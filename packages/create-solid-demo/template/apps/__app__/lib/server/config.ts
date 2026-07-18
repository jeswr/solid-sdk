import { configFromEnv, type PodGuardConfig } from "@jeswr/solid-pod-guard";

/**
 * The pod-guard rail's env prefix: `configFromEnv` reads
 * `__CSD_ENV_PREFIX___TRUSTED_OIDC_ISSUERS`, `__CSD_ENV_PREFIX___POD_ALLOWED_ORIGINS`,
 * `__CSD_ENV_PREFIX___DEV_ALLOW_LOOPBACK`, and
 * `__CSD_ENV_PREFIX___TRUST_FORWARDED_HEADERS` (see .env.example + docs/deploy.md).
 * Everything fails closed while unset.
 */
export const ENV_PREFIX = "__CSD_ENV_PREFIX__";

export function guardConfig(): PodGuardConfig {
  return configFromEnv(ENV_PREFIX);
}
