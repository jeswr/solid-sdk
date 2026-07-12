// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// list(...) — discover app registrations. Two shapes are supported, matching
// Linked-Data-API conventions:
//   1. A registry RESOURCE that itself enumerates fedapp:App subjects (one
//      document holding many App descriptions, or a graph of them).
//   2. An LDP CONTAINER (an app-registry container) whose ldp:contains members
//      are each fetched + parsed for their fedapp:App descriptions.
// Each discovered registration is verified; the result carries both the parsed
// registration and its verification issues.

import { fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import type { AppRegistration, VerificationIssue } from "./types.js";
import { verifyApp } from "./verify.js";
import { wrap } from "./wrappers.js";

/** A single entry returned by {@link list}. */
export interface ListedRegistration {
  /** The app's IRI (its `fedapp:App` subject / client_id). */
  readonly id: string;
  /** The document the registration was read from. */
  readonly source: string;
  /** The parsed registration. */
  readonly registration: AppRegistration;
  /** `true` iff the registration verified clean. */
  readonly valid: boolean;
  /** Verification issues for this registration (empty iff `valid`). */
  readonly issues: readonly VerificationIssue[];
}

/** Options for {@link list}. */
export interface ListOptions {
  /** A `fetch` implementation (e.g. an authenticated Solid fetch). */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Treat `source` as an LDP container and fetch each `ldp:contains` member as a
   * separate registration document. When `false` (default), the source document
   * itself is parsed for inline `fedapp:App` subjects. When `"auto"`, members are
   * followed only if the source declares no inline `fedapp:App` subjects.
   */
  readonly followContainer?: boolean | "auto";
}

/**
 * List app registrations discoverable from a registry resource or container.
 *
 * @param source - URL of a registry resource or an app-registry container.
 * @returns one {@link ListedRegistration} per `fedapp:App` discovered.
 */
export async function list(
  source: string,
  options: ListOptions = {},
): Promise<ListedRegistration[]> {
  const fetchOpts = options.fetch ? { fetch: options.fetch } : {};
  const { dataset } = await fetchRdf(source, fetchOpts);

  const inline = registrationsFromDataset(dataset, source);
  const mode = options.followContainer ?? "auto";

  const shouldFollow = mode === true || (mode === "auto" && inline.length === 0);
  if (!shouldFollow) {
    return inline;
  }

  const memberUrls = containerMembers(dataset, source);
  const out: ListedRegistration[] = [...inline];
  for (const member of memberUrls) {
    try {
      const { dataset: memberDs } = await fetchRdf(member, fetchOpts);
      out.push(...registrationsFromDataset(memberDs, member));
    } catch {
      // A broken member must not sink the whole listing; skip it. The caller
      // sees only the registrations that resolved.
    }
  }
  return out;
}

/** Extract + verify every `fedapp:App` subject in a parsed dataset. */
function registrationsFromDataset(dataset: DatasetCore, source: string): ListedRegistration[] {
  const fed = wrap(dataset);
  return fed.apps().map((app) => {
    // Each app of a (possibly multi-app) registry document is verified
    // independently — verifyApp projects + validates this specific subject.
    const result = verifyApp(app);
    const registration: AppRegistration = result.registration ?? { id: app.value };
    return {
      id: app.value,
      source,
      registration,
      valid: result.valid,
      issues: result.issues,
    };
  });
}

/** Resolve the `ldp:contains` members of a container document to absolute URLs. */
function containerMembers(dataset: DatasetCore, source: string): string[] {
  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) {
    return [];
  }
  return [...container.contains].map((resource) => new URL(resource.id, source).toString());
}
