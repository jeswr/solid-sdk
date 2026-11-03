// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { createIdTokenVerifier } from "./auth.js";
import { nodeHandler } from "./node.js";
import { createRelay } from "./relay.js";

/** Deployment configuration is explicit and fails closed when trust is missing. */
export function configuredRelay(env: NodeJS.ProcessEnv = process.env) {
  const publicUrl = env.RELAY_PUBLIC_URL;
  if (!publicUrl || !env.RELAY_ID_TOKEN_AUDIENCE || !env.RELAY_TRUSTED_ISSUERS)
    throw new Error("Configure relay public URL, ID token audience and trusted issuers");
  const fetch = createNodeGuardedFetch({ maxBytes: 262_144, timeoutMs: 8_000, maxRedirects: 0 });
  const relay = createRelay({
    publicUrl,
    fetch,
    verifyIdToken: createIdTokenVerifier({
      audience: env.RELAY_ID_TOKEN_AUDIENCE,
      issuers: JSON.parse(env.RELAY_TRUSTED_ISSUERS),
      fetch,
    }),
    allowedOrigins: env.RELAY_ALLOWED_ORIGINS?.split(","),
  });
  return { ...relay, handler: nodeHandler(relay, publicUrl) };
}
