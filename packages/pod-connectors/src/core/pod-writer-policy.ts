// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { IntegrationSyncError, PrivateDestinationError } from "./errors.js";
import type { PodWriter } from "./types.js";

/** The health and finance imports that require a host-verified write destination. */
export function requiresPrivateDestination(id: string): boolean {
  return id === "garmin" || id === "whoop" || id === "bank-statements";
}

export async function requirePrivateDestination(
  id: string,
  writer: Pick<PodWriter, "verifyPrivateDestination">,
  url: string,
): Promise<void> {
  try {
    if ((await writer.verifyPrivateDestination?.(url)) === true) return;
  } catch {
    // Transport and policy errors may contain sensitive values. Refuse without echoing them.
  }
  throw new PrivateDestinationError(id);
}

/** Resolve connector slugs identically for every transport. */
export function containerResolver(container: string, adapterId: string) {
  const root = new URL(container);
  if (!root.pathname.endsWith("/") || root.search || root.hash)
    throw new IntegrationSyncError(adapterId, "Expected a container URL ending in /.");
  assertWithinPodScope(root.href, root.href);
  return (slug: string): string => {
    try {
      return assertWithinPodScope(root.href, new URL(slug, root).href, { allowRoot: false });
    } catch (cause) {
      throw new IntegrationSyncError(adapterId, `Slug escapes the adapter container: ${slug}`, {
        cause,
      });
    }
  };
}

export function adapterContainer(adapterId: string, podRoot: string): string {
  if (!/^[a-z0-9-]+$/.test(adapterId))
    throw new IntegrationSyncError(adapterId, "Invalid adapter id.");
  return assertWithinPodScope(podRoot, new URL(`integrations/${adapterId}/`, podRoot).href);
}

const RDF_MEDIA_TYPES = new Set([
  "text/turtle",
  "text/n3",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/rdf+xml",
]);
const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(\s*;\s*[a-z0-9-]+=[a-z0-9-]+)*$/i;

/** Binary ports must never bypass RDF serialisation and provenance. */
export function validateBinaryType(contentType: string, adapterId: string): void {
  const mediaType = String(contentType.split(";", 1)[0]).trim().toLowerCase();
  if (!MEDIA_TYPE.test(contentType) || RDF_MEDIA_TYPES.has(mediaType))
    throw new IntegrationSyncError(adapterId, `Unsupported binary content type: ${mediaType}`);
}

/** A single strong validator; wildcards could turn a Solid write into a blind overwrite. */
export function strongEtag(
  etag: string | null | undefined,
  adapterId: string,
  url: string,
): string {
  if (!etag || !/^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(etag))
    throw new IntegrationSyncError(adapterId, "Existing resource has no strong ETag.", { url });
  return etag;
}
