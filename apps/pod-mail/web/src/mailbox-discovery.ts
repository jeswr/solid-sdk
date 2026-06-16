// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// mailbox-discovery.ts — derive the INBOX MAILBOX DOCUMENT URL the <Inbox
// mailboxUrl /> component needs, from the authenticated session.
//
// A Pod Mail mailbox is a DOCUMENT (`…/mail/folders/inbox.ttl`), not a container
// — so the host must hand the component a document URL, not a bare pod root.
//
// DISCOVERY ORDER (first that yields a usable mail container wins):
//   1. the user's Type Index — read the `solid:publicTypeIndex` (else
//      `solid:privateTypeIndex`) pointer off the WebID profile, fetch that index
//      document, and `locate(schema:EmailMessage)`. A registration points at the
//      app's MAIL ROOT CONTAINER (Pod Mail registers its primary class against
//      `<podRoot>mail/`), so the inbox DOCUMENT is derived as
//      `<mailContainer>folders/inbox.ttl` inside it.
//   2. fallback: the conventional path `folderDocument(podRoot, inbox)` =
//      `<podRoot>mail/folders/inbox.ttl`. The host surfaces a small banner when
//      this fallback is used (no Type-Index registration was found).
//
// All RDF is read through @jeswr/fetch-rdf + typed @rdfjs/wrapper accessors and
// the data layer's `TypeIndexDataset` — never a bespoke parser, never hand-built
// triples (the house rule). The Type-Index POINTER on the profile has no
// @solid/object accessor, so it is read through a tiny typed `TermWrapper`
// subclass below (still a typed accessor, not a hand-walked quad).
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Classes, folderDocument, TypeIndexDataset, WellKnownFolders } from "@jeswr/pod-mail";
import type { DatasetCore } from "@rdfjs/types";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";

const SOLID = "http://www.w3.org/ns/solid/terms#";

/** A WebID subject, exposing its Type-Index pointers via typed accessors. */
class TypeIndexPointers extends TermWrapper {
  /** `solid:publicTypeIndex` on the WebID, if advertised. */
  get publicTypeIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}publicTypeIndex`, NamedNodeAs.string);
  }
  /** `solid:privateTypeIndex` on the WebID, if advertised. */
  get privateTypeIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}privateTypeIndex`, NamedNodeAs.string);
  }
}

/** The resolved mailbox document + whether it came from the conventional fallback. */
export interface DiscoveredMailbox {
  /** The inbox mailbox DOCUMENT URL passed to `<Inbox mailboxUrl />`. */
  mailboxUrl: string;
  /**
   * True when discovery fell back to the conventional path (no
   * `schema:EmailMessage` Type-Index registration was found). The host shows a
   * banner so the user knows the location was assumed, not discovered.
   */
  isFallback: boolean;
  /** How the URL was derived, for the banner / diagnostics. */
  source: "type-index" | "convention";
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Derive the inbox mailbox DOCUMENT inside a discovered mail ROOT container.
 * Pod Mail's layout is `<mailRoot>folders/<slug>.ttl`, so the inbox document is
 * `<mailContainer>folders/inbox.ttl`. Built with `new URL` (never string concat)
 * so the container's own path is honoured.
 */
function inboxDocInContainer(mailContainer: string): string {
  return new URL(`folders/${WellKnownFolders.inbox}.ttl`, asContainer(mailContainer)).toString();
}

/**
 * Read a Type-Index document and return the FIRST container registered for
 * `schema:EmailMessage`, or undefined when the fetch/parse fails or no
 * registration exists. A registration may use `solid:instance` (a single
 * resource) or `solid:instanceContainer` (a container); Pod Mail registers a
 * container, so we prefer `container` and accept `instance`'s parent as a
 * last resort. Never throws — discovery failure degrades to the convention.
 */
async function mailContainerFromIndex(
  indexUrl: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  let dataset: DatasetCore;
  try {
    ({ dataset } = await fetchRdf(indexUrl, fetchImpl ? { fetch: fetchImpl } : undefined));
  } catch {
    return undefined; // missing / unreadable index → fall back to the convention.
  }
  const index = new TypeIndexDataset(dataset, DataFactory);
  for (const entry of index.locate(Classes.EmailMessage)) {
    if (entry.container !== undefined) return entry.container;
    // A single-instance registration: the mail container is its parent.
    if (entry.instance !== undefined) return new URL("./", entry.instance).toString();
  }
  return undefined;
}

/**
 * Discover the inbox mailbox document for a session. Tries the public then the
 * private Type Index for a `schema:EmailMessage` registration; on any failure or
 * absence, returns the conventional `<podRoot>mail/folders/inbox.ttl` with
 * `isFallback: true`.
 *
 * `profileDataset` is the already-fetched WebID profile dataset (the host reads
 * it once for the session); we read the Type-Index pointer off it via a typed
 * accessor rather than re-fetching. `fetchImpl` is the authenticated fetch (omit
 * to use the auth-patched global).
 */
export async function discoverMailbox(
  webId: string,
  podRoot: string,
  profileDataset: DatasetCore,
  fetchImpl?: typeof fetch,
): Promise<DiscoveredMailbox> {
  const pointers = new TypeIndexPointers(webId, profileDataset, DataFactory);
  const indexUrls = [pointers.publicTypeIndex, pointers.privateTypeIndex].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  for (const indexUrl of indexUrls) {
    const container = await mailContainerFromIndex(indexUrl, fetchImpl);
    if (container !== undefined) {
      return {
        mailboxUrl: inboxDocInContainer(container),
        isFallback: false,
        source: "type-index",
      };
    }
  }
  // No registration discoverable → the conventional inbox document.
  return {
    mailboxUrl: folderDocument(podRoot, WellKnownFolders.inbox),
    isFallback: true,
    source: "convention",
  };
}
