// AUTHORED-BY Claude Fable 5.2
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import type { PodSession } from "./pod-session";

/** A capabilities cache for `createPodClient`, seeded only for the built-in demo pod. */
export async function sessionCapabilitiesCache(
  session: Pick<PodSession, "mode" | "storageUrl" | "webId">,
) {
  const cache = createMemoryCache();
  // The trusted demo fixture has no storage-description service. Seed only that
  // fixture's discovery cache; real pods still require advertised discovery.
  if (session.mode === "demo") {
    await cache.set(session.storageUrl, {
      version: 3,
      // The built-in demo pod advertises these WAC links on HEAD; its OPTIONS
      // response has no discovery headers. This is feature metadata only:
      // checkOwnerOnly still reads and validates every governing ACL.
      probe: {
        url: session.storageUrl,
        observedAt: Date.now(),
        aclLink: new URL(".acl", session.storageUrl).href,
        evidence: [],
      },
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
  return cache;
}
