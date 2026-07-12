// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Public domain types for the federation client: the plain-object views over a
// fedapp:App registration that `verify`/`list`/`selfDescribe` exchange. The RDF
// itself is read/written through @rdfjs/wrapper typed accessors (never these
// objects directly) — these are the SDK's ergonomic surface.

import type { AccessMode } from "./vocab.js";

/**
 * Per-sector usage block — the nested form (`fedapp:SectorUse`) where access
 * modes / consumed / produced shapes differ per sector.
 */
export interface SectorUse {
  /** Identifier of the SectorUse node (a blank-node id or IRI). */
  readonly id?: string;
  /** The data sector IRI operated in (`fedapp:sector`). */
  readonly sector: string;
  /** WAC/ACP access modes requested in this sector (`fedapp:access`). */
  readonly access: readonly AccessMode[];
  /** Shared shapes read in this sector (`fedapp:consumes`). */
  readonly consumes?: readonly string[];
  /** Shared shapes written in this sector (`fedapp:produces`). */
  readonly produces?: readonly string[];
}

/**
 * A plain-object view of an `fedapp:App` registration. The subject is typically
 * the app's `client_id` IRI (its Client Identifier Document).
 */
export interface AppRegistration {
  /** The app's IRI — typically its `client_id`. */
  readonly id: string;
  /** Flat-form sector IRIs (`fedapp:sector` directly on the App). */
  readonly sectors?: readonly string[];
  /** Flat-form access modes (`fedapp:access` directly on the App). */
  readonly access?: readonly AccessMode[];
  /** Flat-form consumed shapes (`fedapp:consumes` directly on the App). */
  readonly consumes?: readonly string[];
  /** Flat-form produced shapes (`fedapp:produces` directly on the App). */
  readonly produces?: readonly string[];
  /** SHACL node shapes this app authors (`fedapp:declaresShape`). */
  readonly declaresShape?: readonly string[];
  /** Nested per-sector usage blocks (`fedapp:sectorUse`). */
  readonly sectorUse?: readonly SectorUse[];
}

/** A single validation problem found by {@link verify}. */
export interface VerificationIssue {
  /** Machine-readable code (e.g. `missing-type`, `invalid-access-mode`). */
  readonly code: VerificationIssueCode;
  /** Human-readable description. */
  readonly message: string;
  /** The offending subject IRI / blank-node id, where applicable. */
  readonly subject?: string;
  /** The offending value (e.g. the unknown access-mode IRI), where applicable. */
  readonly value?: string;
}

/** The closed set of issue codes {@link verify} can emit. */
export type VerificationIssueCode =
  | "no-app"
  | "multiple-apps"
  | "subject-mismatch"
  | "missing-access"
  | "invalid-access-mode"
  | "invalid-term-type"
  | "sector-use-missing-sector"
  | "sector-use-missing-access"
  | "empty-registration"
  | "fetch-failed"
  | "parse-failed";

/** The result of verifying an app registration. */
export interface VerificationResult {
  /** `true` when the registration is well-formed against the fedapp vocab. */
  readonly valid: boolean;
  /** The parsed registration, when one well-formed `fedapp:App` was found. */
  readonly registration?: AppRegistration;
  /** All problems found. Empty iff `valid`. */
  readonly issues: readonly VerificationIssue[];
}
