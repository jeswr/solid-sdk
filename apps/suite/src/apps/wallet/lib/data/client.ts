// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { createBitstringStatusResolver, createWebIdKeyResolver } from "@jeswr/solid-vc";
import { createWalletRepository } from "@jeswr/solid-wallet";
import { createPodClient } from "@jeswr/storage-client";
import { sessionCapabilitiesCache } from "@/lib/session/capabilities-cache";
import type { PodSession } from "@/lib/session/pod-session";
export async function openWallet(session: PodSession) {
  const cache = await sessionCapabilitiesCache(session);
  const { storage } = await createPodClient({
    fetch: session.fetch,
    storage: session.storageUrl,
    capabilities: cache,
  });
  return {
    storage,
    repository: createWalletRepository({ storage, fetch: session.fetch, webId: session.webId }),
  };
}
/** Issuer/status requests use the credential-free public transport, never the pod's auth fetch. */
export function walletVerification(session: PodSession, now = new Date()) {
  const fetch =
    session.mode === "demo"
      ? session.fetch
      : createGuardedFetch({
          fetch: session.publicFetch,
          dnsLookup: null,
          maxRedirects: 0,
          maxBytes: 2_097_152,
        });
  const resolver = createWebIdKeyResolver({ fetch });
  return {
    ...resolver,
    now,
    resolveStatus: createBitstringStatusResolver({
      ...resolver,
      fetch,
      now,
      maxBodyBytes: 2_097_152,
    }),
  };
}
