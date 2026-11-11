// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { createIdTokenVerifier } from "./auth.js";
import { nodeHandler } from "./node.js";
import { createRelayOutboundFetch, isTestOutboundFetch } from "./outbound.js";
import { configuredDelivery } from "./push-config.js";
import type { DeliveryOptions } from "./push-delivery.js";
import type { PushSink } from "./push-payload.js";
import { createRelay } from "./relay.js";
import type { RelayStore } from "./store.js";

type RelayDependencies = {
  outboundFetch?: typeof fetch;
  store?: RelayStore;
  pushSink?: PushSink;
  onInvalid?: DeliveryOptions["onInvalid"];
};

/** Deployment configuration is explicit and fails closed when trust is missing. */
export function configuredRelay(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: RelayDependencies = {},
) {
  const publicUrl = env.RELAY_PUBLIC_URL;
  if (!publicUrl || !env.RELAY_ID_TOKEN_AUDIENCE || !env.RELAY_TRUSTED_ISSUERS)
    throw new Error("Configure relay public URL, ID token audience and trusted issuers");
  const fetch = dependencies.outboundFetch ?? createRelayOutboundFetch();
  const deliverySink = configuredDelivery(env, dependencies.onInvalid, fetch);
  const relay = createRelay({
    publicUrl,
    fetch,
    allowInsecureLoopback: isTestOutboundFetch(fetch),
    mobileClientId: env.RELAY_MOBILE_CLIENT_ID,
    store: dependencies.store,
    pushSink: dependencies.pushSink ?? deliverySink,
    verifyIdToken: createIdTokenVerifier({
      audience: env.RELAY_ID_TOKEN_AUDIENCE,
      issuers: JSON.parse(env.RELAY_TRUSTED_ISSUERS),
      fetch,
    }),
    allowedOrigins: env.RELAY_ALLOWED_ORIGINS?.split(","),
  });
  // Dead provider tokens remove the installation only through the routes' version-checked commit.
  if (deliverySink && !dependencies.onInvalid)
    deliverySink.options.onInvalid = relay.invalidatePush;
  return {
    ...relay,
    handler: nodeHandler(relay, publicUrl),
    deliverySink,
    close() {
      relay.close();
      deliverySink?.close();
    },
  };
}

/** Both deployment entry points use this gate; production never accepts a test transport. */
export function productionRelay(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: RelayDependencies = {},
) {
  if (env.NODE_ENV !== "production" || dependencies.outboundFetch !== undefined)
    throw new Error("Production relay requires NODE_ENV=production and its own outbound transport");
  return configuredRelay(env, dependencies);
}
