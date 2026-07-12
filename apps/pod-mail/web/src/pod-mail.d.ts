// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Ambient typing for the @jeswr/pod-mail data-layer barrel the host consumes for
// mailbox discovery. Vite bundles the library's TS SOURCE directly (vite.config
// alias), but tsc must NOT type-check the out-of-root library source (it is
// type-checked in its own package). So we declare ONLY the public surface the
// host imports — the path conventions + the typed Type-Index reader + the class
// IRIs — kept in lock-step with ../src/model/{paths,typeIndex,vocab,folder}.ts.
// If those signatures change, update this declaration in the same change.
declare module "@jeswr/pod-mail" {
  import type { DatasetCore } from "@rdfjs/types";

  /** Ensure a container URL ends in a single trailing slash. */
  export function asContainer(url: string): string;
  /** The app's mail root container under a pod root (`<podRoot>mail/`). */
  export function mailRoot(podRoot: string): string;
  /**
   * The document for a named folder (e.g. "inbox" →
   * `<podRoot>mail/folders/inbox.ttl`). The slug is URL-encoded.
   */
  export function folderDocument(podRoot: string, folder: string): string;

  /** Conventional well-known mail folder slugs (relative to the mail root). */
  export const WellKnownFolders: {
    readonly inbox: "inbox";
    readonly sent: "sent";
    readonly drafts: "drafts";
    readonly trash: "trash";
    readonly archive: "archive";
  };

  /** RDF classes used by the mail data layer. */
  export const Classes: {
    readonly EmailMessage: string;
    readonly Conversation: string;
    readonly SiocThread: string;
    readonly Folder: string;
    readonly ContactPoint: string;
    readonly LdpContainer: string;
  };

  /** A type-index document, wrapped whole, with `locate(classIri)`. */
  export class TypeIndexDataset {
    constructor(dataset: DatasetCore, factory: unknown);
    /** Find the location(s) registered for a class IRI. */
    locate(classIri: string): { instance?: string; container?: string }[];
    /** Whether a registration for the class already exists. */
    hasRegistrationFor(classIri: string): boolean;
  }
}
