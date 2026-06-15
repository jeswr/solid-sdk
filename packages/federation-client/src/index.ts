// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/federation-client` — a typed TypeScript client for the Solid
 * app-registration / federation vocabulary (`fedapp:`) at
 * `https://w3id.org/jeswr/fed#`.
 *
 * Three entry points:
 * - {@link verify} — fetch + validate an app's federation registration document.
 * - {@link list} — discover/list app registrations from a registry resource or
 *   an app-registry container.
 * - {@link selfDescribe} — build an app's own `fedapp:App` self-description graph
 *   for publication in its Client Identifier Document.
 *
 * RDF discipline: parse via `@jeswr/fetch-rdf`, extract via `@rdfjs/wrapper` /
 * `@solid/object`, serialise via `n3.Writer`. Never a bespoke parser.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */

export type { ListedRegistration, ListOptions } from "./list.js";
export { list } from "./list.js";
export type { SelfDescription } from "./selfDescribe.js";
export { selfDescribe } from "./selfDescribe.js";
export { serialize } from "./serialize.js";
export type {
  AppRegistration,
  SectorUse,
  VerificationIssue,
  VerificationIssueCode,
  VerificationResult,
} from "./types.js";
export type { VerifyDatasetOptions, VerifyOptions } from "./verify.js";
export { verify, verifyDataset } from "./verify.js";

export {
  ACL_MODES,
  type AccessMode,
  accessModeName,
  FEDAPP,
  KNOWN_SECTOR_SLUGS,
  type SectorSlug,
  sectorIri,
  VALID_ACCESS_MODE_IRIS,
} from "./vocab.js";
