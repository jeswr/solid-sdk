// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { IntegrationSyncError, PrivateDestinationError } from "./errors.js";
import type { MutationGuard, PodWriter } from "./types.js";

/** The health and finance imports that require a host-verified write destination. */
export function requiresPrivateDestination(id: string): boolean {
  return id === "garmin" || id === "whoop" || id === "bank-statements";
}

export async function requirePrivateDestination(
  id: string,
  writer: Pick<PodWriter, "verifyPrivateDestination">,
  url: string,
  guard?: MutationGuard,
): Promise<void> {
  try {
    const verified =
      guard && writer.verifyPrivateDestination?.beforeWrite
        ? await writer.verifyPrivateDestination.beforeWrite(url, guard)
        : await writer.verifyPrivateDestination?.(url);
    if (verified === true) return;
  } catch {
    // Transport and policy errors may contain sensitive values. Refuse without echoing them.
  }
  throw new PrivateDestinationError(id);
}

/** Confirm a successful write. A refused replacement must preserve earlier records. */
export async function requirePrivateWriteConfirmation(
  id: string,
  writer: Pick<PodWriter, "confirmPrivateWrite" | "cleanupPrivateWrite">,
  slug: string,
  url: string,
  created: boolean,
  writeEtag?: string | null,
  onRefusal?: (refusal: Promise<PrivateDestinationError>) => void,
): Promise<void> {
  const version = writeEtag == null ? {} : { etag: writeEtag };
  let observed: string | undefined;
  try {
    const confirmed = await writer.confirmPrivateWrite?.(url, version, (etag) => {
      if (observed === undefined && isStrongEtag(etag)) observed = etag;
    });
    if (confirmed === true) return;
  } catch {
    // Keep policy and transport errors out of the host's diagnostics.
  }
  const etag = isStrongEtag(writeEtag) ? writeEtag : observed;
  const refusal = Promise.resolve().then(async () => {
    let removed = false;
    if (created && isStrongEtag(etag) && writer.cleanupPrivateWrite) {
      const signal = AbortSignal.timeout(10_000);
      try {
        const expired = new Promise<false>((resolve) =>
          signal.addEventListener("abort", () => resolve(false), { once: true }),
        );
        removed =
          (await Promise.race([writer.cleanupPrivateWrite(slug, { etag, signal }), expired])) ===
          true;
      } catch {
        // A failed cleanup leaves the file potentially visible.
      }
    }
    return new PrivateDestinationError(id, { url, removed });
  });
  onRefusal?.(refusal);
  throw await refusal;
}

/** Delete a refused create, then check its exact URL once for absence. */
export async function cleanupPrivateResource(
  fetch: typeof globalThis.fetch,
  url: string,
  { etag, signal }: { etag: string; signal: AbortSignal },
): Promise<boolean> {
  if (!isStrongEtag(etag)) return false;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "if-match": etag },
    redirect: "error",
    signal,
  });
  void response.body?.cancel().catch(() => {});
  if (![200, 204, 404, 410].includes(response.status)) return false;
  signal.throwIfAborted();
  const head = await fetch(url, { method: "HEAD", redirect: "error", cache: "no-cache", signal });
  return head.status === 404 || head.status === 410;
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

/** A single strong validator; wildcards could turn a Solid mutation into a blind one. */
export function isStrongEtag(etag: string | null | undefined): etag is string {
  return typeof etag === "string" && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
}

export function strongEtag(
  etag: string | null | undefined,
  adapterId: string,
  url: string,
): string {
  if (!isStrongEtag(etag))
    throw new IntegrationSyncError(adapterId, "Existing resource has no strong ETag.", { url });
  return etag;
}
