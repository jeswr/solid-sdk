// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { createBitstringStatusResolver, createWebIdKeyResolver } from "@jeswr/solid-vc";
import { createWalletRepository } from "@jeswr/solid-wallet";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";
export async function openWallet(session: PodSession) {
  // The trusted demo fixture has no storage-description service. Seed only that
  // fixture's discovery cache; real pods still require advertised discovery.
  const cache = createMemoryCache();
  if (session.mode === "demo") {
    await cache.set(session.storageUrl, {
      version: 3,
      description: {
        protocol: "solid",
        id: session.storageUrl,
        root: session.storageUrl,
        owner: session.webId,
        descriptionUrl: null,
        services: [],
        capabilities: [],
        sources: ["probe"],
        fetchedAt: Date.now(),
        etag: null,
        maxAgeMs: 3_600_000,
        verificationMethods: [],
      },
    });
    await cache.rememberPrefix(session.storageUrl, session.storageUrl);
  }
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
