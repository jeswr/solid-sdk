// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { IntegrationSyncError, PrivateDestinationError } from "./errors.js";
import type { MutationGuard, PodWriter } from "./types.js";

/**
 * Privacy classification of every registered connector id. `private` imports require a
 * host-verified owner-only destination before any write, confirmation after it and clean-up on
 * refusal. `public-ok` is an explicit decision that the imported data is unquestionably public
 * by nature; no registered connector qualifies today (see the README table).
 *
 * The policy is default-private: `requiresPrivateDestination` returns true for an id missing
 * from this table, so an unclassified adapter (a host's own, or a new one) fails closed until
 * someone classifies it. A registry test also fails for an unclassified registered adapter.
 */
export const CONNECTOR_PRIVACY = {
  // Health and location.
  "activity-files": "private",
  "apple-health": "private",
  fitbit: "private",
  garmin: "private",
  strava: "private",
  whoop: "private",
  // Finance and purchases.
  "amazon-orders": "private",
  "bank-statements": "private",
  uber: "private",
  // Messages, mail, contacts, calendar and personal documents.
  chatgpt: "private",
  gmail: "private",
  "google-calendar": "private",
  "google-contacts": "private",
  "google-drive": "private",
  "google-takeout": "private",
  whatsapp: "private",
  // An import of a person's own account data is private unless the data is unquestionably
  // public by nature. GitHub was the only candidate, but its adapter requests the `repo` scope
  // and lists `/user/repos`, which includes private repositories, so it is private too.
  // Social, media, storage, notes, accounts and smart-home imports:
  discord: "private",
  dropbox: "private",
  facebook: "private",
  github: "private",
  goodreads: "private",
  "google-photos": "private",
  instagram: "private",
  linkedin: "private",
  netflix: "private",
  notion: "private",
  pinterest: "private",
  reddit: "private",
  slack: "private",
  spotify: "private",
  steam: "private",
  tiktok: "private",
  twitch: "private",
  vesync: "private",
  "x-twitter": "private",
  youtube: "private",
} as const satisfies Record<string, "private" | "public-ok">;

type ConnectorId = keyof typeof CONNECTOR_PRIVACY;

/** Whether a connector id has an explicit privacy classification. */
export function isClassifiedConnector(id: string): boolean {
  return Object.hasOwn(CONNECTOR_PRIVACY, id);
}

/** Imports that require a host-verified write destination: private, or not classified at all. */
export function requiresPrivateDestination(id: string): boolean {
  return (
    !Object.hasOwn(CONNECTOR_PRIVACY, id) || CONNECTOR_PRIVACY[id as ConnectorId] === "private"
  );
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
