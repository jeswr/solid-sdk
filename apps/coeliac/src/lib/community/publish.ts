// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The pod write path for a share card (Phase 4B, design §4.3) — **owner-only ACL,
 * fail-closed, written FIRST**, in a DISJOINT `/community/` scope that never
 * touches (or widens) the diary.
 *
 * All I/O goes through the session StorageClient, tested with SDK memory storage.
 * The owner-only ACL is authored by `@jeswr/solid-health-diary`'s reviewed `buildOwnerOnlyAcl` (never a
 * hand-built triple), written on the community ROOT before any share resource, so
 * shares inherit owner-only access and nothing is ever briefly world-readable.
 *
 * The diary is structurally untouchable from here: `assertCommunityScope` refuses
 * any write target that is not under `${storageRoot}community/` (or that is a diary
 * IRI), and the card serialiser refuses any diary IRI in the body — so a share can
 * never expose the diary. The card publish path and the owner-only provenance
 * SIDECAR are SEPARATE functions: the card is structurally incapable of bundling
 * the source link (design §4.1).
 */
import type { StorageClient } from "@jeswr/storage-client";
import { DataFactory, Writer } from "n3";
import { PROV } from "@jeswr/solid-health-diary";
import { type PodStorage, resolvePodStorage } from "../pod/client";
import { ensureContainer, putResource, writeOwnerOnlyAcl } from "../pod/pod-fs";
import type { ShareCard } from "./share-card";
import { assertShareable, ShareSanitizationError } from "./share";
import { serializeShareCard } from "./share-rdf";
import {
  assertCommunityScope,
  communityContainers,
  communityRoot,
  containsDiaryScope,
  shareProvenanceSidecarUrl,
  shareUrl,
} from "./share-layout";

const { namedNode, quad } = DataFactory;

/**
 * Assert `iri` is an ABSOLUTE http(s) URL whose normalised path is under the diary
 * scope, and return its normalised href (roborev Medium: the sidecar previously
 * accepted any string containing `/health/diary/`, incl. relative/malformed values
 * that produce invalid Turtle). The sidecar records ONLY real diary resource URLs.
 */
function assertDiaryResourceUrl(iri: string): string {
  let u: URL;
  try {
    u = new URL(iri);
  } catch {
    throw new Error(`provenance sidecar requires an absolute diary URL; got: ${iri}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`provenance sidecar requires an http(s) diary URL; got: ${iri}`);
  }
  if (!containsDiaryScope(u.href)) {
    throw new Error(`provenance sidecar only records diary IRIs; got: ${iri}`);
  }
  return u.href;
}

/** In-memory "community scope ready" memo (test seam via {@link resetCommunityReadyMemo}). */
let readyKeys = new WeakMap<StorageClient, Set<string>>();

/** Reset the "community ready" memo (test seam / after logout). */
export function resetCommunityReadyMemo(): void {
  readyKeys = new WeakMap();
}

/**
 * Provision the community scope for a WebID: ensure the `/community/` root exists
 * AND write its owner-only ACL (accessTo + default) FIRST — fail-closed: if the ACL
 * write throws, the key is NOT memoised, so nothing is written into an unprotected
 * container. Disjoint from the diary: every target is asserted to be under
 * `${storageRoot}community/`, so this can never touch a diary resource.
 */
export async function ensureCommunityReady(
  storage: PodStorage,
  storageRoot: string,
  ownerWebId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const root = communityRoot(storageRoot);
  const key = `${root} ${ownerWebId}`;
  const client = await resolvePodStorage(storage);
  const ready = readyKeys.get(client) ?? new Set<string>();
  readyKeys.set(client, ready);
  if (!opts.force && ready.has(key)) return;

  assertCommunityScope(root, storageRoot);
  await ensureContainer(client, root);
  await writeOwnerOnlyAcl(client, root, ownerWebId);

  for (const container of communityContainers(storageRoot)) {
    if (container === root) continue;
    assertCommunityScope(container, storageRoot);
    await ensureContainer(client, container);
  }
  ready.add(key);
}

/**
 * Publish a sanitised share card to `…/community/shares/{ulid}.ttl` (owner-only by
 * default — widening to a group/public is a later, explicit consent action, 4B-2).
 * Fail-closed at every step:
 *  - re-runs {@link assertShareable} (defence in depth — a card that could leak the
 *    diary/genetics/provenance or a real public identity is refused);
 *  - asserts the write target is inside the community scope (never a diary IRI);
 *  - provisions the owner-only ACL FIRST.
 *
 * @returns the published card resource URL.
 */
export async function publishShareCard(
  storage: PodStorage,
  storageRoot: string,
  ownerWebId: string,
  ulid: string,
  card: ShareCard,
): Promise<string> {
  // A PUBLIC card cannot be published to the user's OWN pod: its resource IRI
  // (`…{ownerHost}/community/shares/…`) is itself origin-linkable to the real WebID
  // (design §4.2, roborev). Same-pod publishing is for owner-only / group only;
  // public cards are published from a separate unlinkable origin — the 4B-2 flow.
  if (card.audience === "public") {
    throw new ShareSanitizationError(
      "a public card cannot be published to your own pod — its resource IRI is origin-linkable to your WebID; publish public cards from a separate unlinkable origin (4B-2)",
    );
  }

  // Defence in depth: the guard the generator already ran, re-run at the boundary.
  assertShareable(card, { realWebId: ownerWebId });

  const url = assertCommunityScope(shareUrl(storageRoot, ulid), storageRoot);
  const subjectIri = `${url}#it`;
  const withId: ShareCard = { ...card, message: { ...card.message, id: subjectIri } };
  assertShareable(withId, { realWebId: ownerWebId });

  const ttl = await serializeShareCard(withId, subjectIri);

  await ensureCommunityReady(storage, storageRoot, ownerWebId);
  await putResource(storage, url, ttl);
  return url;
}

/**
 * Serialise the OWNER-ONLY provenance sidecar for a share (design §4.1): a separate
 * `…/shares/{ulid}.provenance.ttl` resource carrying `prov:wasDerivedFrom` to the
 * diary IRIs the card was derived from, for the user's OWN bookkeeping. It lives in
 * the owner-only community scope and is NEVER bundled into the shareable card —
 * this function is deliberately separate from {@link publishShareCard}.
 *
 * `derivedFrom` MUST be diary IRIs (that is the whole point of the sidecar); a
 * non-diary IRI is rejected so this cannot be misused to sneak an arbitrary link.
 */
export async function serializeProvenanceSidecar(
  subjectIri: string,
  derivedFrom: readonly string[],
): Promise<string> {
  const s = namedNode(subjectIri);
  const writer = new Writer({ format: "text/turtle", prefixes: { prov: PROV } });
  for (const iri of derivedFrom) {
    writer.addQuad(quad(s, namedNode(`${PROV}wasDerivedFrom`), namedNode(assertDiaryResourceUrl(iri))));
  }
  return await new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/**
 * Write the owner-only provenance sidecar for a share (design §4.1). Provisions the
 * owner-only community scope first (so the sidecar inherits owner-only access), then
 * PUTs it at `…/shares/{ulid}.provenance.ttl`. SEPARATE from the card publish path.
 *
 * @returns the sidecar resource URL.
 */
export async function writeShareProvenanceSidecar(
  storage: PodStorage,
  storageRoot: string,
  ownerWebId: string,
  ulid: string,
  derivedFrom: readonly string[],
): Promise<string> {
  const url = assertCommunityScope(shareProvenanceSidecarUrl(storageRoot, ulid), storageRoot);
  const ttl = await serializeProvenanceSidecar(`${url}#it`, derivedFrom);
  await ensureCommunityReady(storage, storageRoot, ownerWebId);
  await putResource(storage, url, ttl);
  return url;
}
