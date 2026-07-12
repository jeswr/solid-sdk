// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The chat view's room-list READ facade — the single place the view enters the
// data layer for the room listing. It does its OWN container GET (via the data
// layer's `readRdf`) and parses the LDP listing with `@solid/object`'s
// `ContainerDataset`, mirroring `ChatStore.listContainer` — but with one crucial
// difference in how it treats an access failure on the container.
//
// ── WAC-aware (the reason this facade exists) ────────────────────────────────
// The data-layer `ChatStore.listContainer` deliberately maps a 401/403/404 on
// the rooms container itself to `[]` (a freshly-provisioned pod may register a
// container in the Type Index before it is created, and `listMessages` shares
// that swallow). A chat SCREEN, though, must tell "you have no rooms" apart from
// "you can't see the rooms container", so this facade raises a typed
// {@link RoomsAccessError} on 401/403 — exactly the branch the view needs to
// render the access-denied state (the same state `useChat` already shows for a
// 401/403 on the message thread). A 404 (a not-yet-created container) and a
// genuinely-empty 2xx container both map to an empty list — those ARE "no rooms".
// We do NOT change `ChatStore.listRooms`/`listContainer`, because other callers
// (`listMessages`, the store's own tests) depend on the swallow behaviour.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, never imported (see the data layer's
// note in src/rdf-io.ts). Pass the session's fetch via `fetch`; omit it and the
// data layer falls back to the global fetch — which, in a real session,
// @solid/reactive-authentication patches so a plain fetch transparently upgrades
// with a DPoP token. That wiring is the create-solid-app shell's job (#18-gated:
// https://github.com/solid-contrib/reactive-authentication/issues/18); this
// facade is deliberately unaware of it and works today against a stub fetch.

import { RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { readRdf } from "../rdf-io.js";
import type { ResourceEntry } from "../store.js";

/**
 * Raised when the pod refuses access (HTTP 401/403) to the rooms container being
 * listed. Distinct from an empty/absent container (which maps to an empty list)
 * so the view can branch: 401 → prompt login, 403 → "you don't have permission".
 */
export class RoomsAccessError extends Error {
  readonly status: 401 | 403;
  readonly url: string;
  constructor(status: 401 | 403, url: string, cause: unknown) {
    super(
      status === 401
        ? `Authentication required to list rooms at ${url}`
        : `Forbidden: no permission to list rooms at ${url}`,
    );
    this.name = "RoomsAccessError";
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

/**
 * List the rooms in `roomsContainer`, surfacing a 401/403 as a typed
 * {@link RoomsAccessError} instead of swallowing it to an empty list.
 *
 *   - **401 / 403** → throws {@link RoomsAccessError} (the view shows the
 *     access-denied state rather than a misleading "No rooms.").
 *   - **404** → an empty list (a not-yet-created container is the new-pod case,
 *     not an error — same as the store).
 *   - **2xx with no contained resources** → an empty list (genuinely empty).
 *   - any other failure (5xx, network, parse) → re-thrown unchanged (the view
 *     renders it generically + a retry).
 *
 * One GET reads the container listing; member resources are NOT read here (the
 * hook point-reads each room descriptor for its metadata). Sub-containers and
 * the container's own self-description are skipped, and entries are sorted by
 * name — matching `ChatStore.listContainer`.
 *
 * @throws {RoomsAccessError} on 401 / 403 reading the rooms container.
 */
export async function listRoomsOrAccessError(
  roomsContainer: string,
  options: { fetch?: typeof fetch } = {},
): Promise<ResourceEntry[]> {
  const { fetch: authedFetch } = options;

  let dataset: DatasetCore;
  try {
    ({ dataset } = await readRdf(roomsContainer, authedFetch));
  } catch (error) {
    if (error instanceof RdfFetchError) {
      if (error.status === 401 || error.status === 403) {
        throw new RoomsAccessError(error.status, roomsContainer, error);
      }
      if (error.status === 404 || error.status === 410) {
        return []; // a not-yet-created (or gone) container is "no rooms", not an error
      }
    }
    throw error;
  }

  const container = new ContainerDataset(dataset, DataFactory).container;
  const out: ResourceEntry[] = [];
  for (const r of container?.contains ?? []) {
    if (r.id === roomsContainer) continue; // the container's self-description
    if (r.isContainer) continue; // sub-containers are not data rows
    out.push({
      url: r.id,
      name: r.name,
      isContainer: r.isContainer,
      modified: r.modified?.toISOString(),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
