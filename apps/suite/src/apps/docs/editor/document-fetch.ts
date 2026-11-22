// AUTHORED-BY Claude Opus 5.5
import { podScopedFetch } from "@jeswr/suite-sdk/pod-scoped-fetch";
import type { PodSession } from "@/lib/session/pod-session";
import { docContainerUrls } from "../lib/model/layout";

/**
 * Credentials reach the user's storage and the opened document's own container (comments,
 * versions, update log and assets), so a document shared from another pod keeps working without
 * granting credentials to the rest of that pod. Chips keep the strict storage-only scope.
 */
export function documentCredentialRoots(storageUrl: string, resource?: string): string[] {
  if (!resource) return [storageUrl];
  try {
    return [storageUrl, docContainerUrls(resource).container];
  } catch {
    return [storageUrl];
  }
}

/** Reads the resource per request, so a draft that is created later gains its own container. */
export function documentScopedFetch(
  session: Pick<PodSession, "fetch" | "storageUrl">,
  resource: () => string | undefined,
): typeof fetch {
  return (input, init) =>
    podScopedFetch(session.fetch, documentCredentialRoots(session.storageUrl, resource()))(
      input,
      init,
    );
}
