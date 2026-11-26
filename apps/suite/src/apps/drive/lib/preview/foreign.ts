// AUTHORED-BY Claude Sonnet 5.5
import { isOwnPodIri, podScopedFetch } from "@jeswr/suite-sdk/pod-scoped-fetch";
import { isPublicHttpsUrl } from "@jeswr/suite-sdk/shared";
import type { ImageResolver } from "@jeswr/suite-ui";
import { isOwnStorage } from "../client/ownership";
import { createPreviewImageResolver } from "./image-resolver";

/** Largest image a previewed foreign document may make the browser read. */
export const FOREIGN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Secondary reads named by a foreign response (preview images, a storage description, an owner
 * WebID) stay inside the previewed resource's own origin, over public HTTPS, and never reach the
 * user's own pod. They carry no credentials: the scope list is empty, so nothing is "own".
 */
export function foreignSecondaryFetch(
  session: { storageUrl: string },
  resourceUrl: string,
): typeof fetch {
  const origin = (() => {
    try {
      return new URL(resourceUrl).origin;
    } catch {
      return undefined;
    }
  })();
  const credentialFree = podScopedFetch(fetch, []);
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const allowed =
      origin !== undefined &&
      isPublicHttpsUrl(resourceUrl) &&
      isPublicHttpsUrl(url) &&
      isOwnPodIri(url, `${origin}/`) &&
      !isOwnPodIri(url, session.storageUrl);
    if (!allowed) return Promise.reject(new TypeError("Blocked a request outside the shared pod"));
    return credentialFree(input, init);
  };
}

/**
 * Images a previewed document names: read with the session inside the user's storage exactly as
 * before; for a document outside it, same origin as that document, credential-free and capped.
 */
export function previewImageResolverFor(
  session: { fetch: typeof fetch; storageUrl: string },
  resourceUrl: string,
): ImageResolver {
  return isOwnStorage(resourceUrl, session.storageUrl)
    ? createPreviewImageResolver((url, init) => session.fetch(url, init))
    : createPreviewImageResolver(foreignSecondaryFetch(session, resourceUrl), {
        maxBytes: FOREIGN_IMAGE_MAX_BYTES,
      });
}
