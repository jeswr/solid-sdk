// Ported from apps/pod-manager/src/lib/forms/resolve-form.ts
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Form resolution (Wave 5 §2): given a subject to edit (and optionally a `ui:`
 * form description), pick the field set, in this precedence:
 *
 *  1. an explicit Solid `ui:` form (`parseUiForm`) — authored, most specific;
 *  2. a first-party typed-view edit map (`edit-map.ts`) — when a known typed
 *     viewer matches the resource (contacts/music/photo/event/bookmark);
 *  3. an auto-generated form from the subject's own properties
 *     (`auto-form.ts`) — the "edit anything" floor.
 *
 * Pure: takes parsed datasets, returns a `ResolvedForm`. The renderer + writer
 * are shared across all three, so the editing UX is identical regardless of
 * which path produced the fields.
 */

import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermAs } from "@rdfjs/wrapper";
import { subjectOf } from "../model/rdf";
import { autoFormFor } from "./auto-form.js";
import { editFieldsFor } from "./edit-map.js";
import type { FieldSpec } from "./field-types.js";
import { parseUiForm } from "./ui-form.js";

/** Where the resolved fields came from (drives UI hints + analytics). */
export type FormSource = "ui-form" | "typed-view" | "auto";

export interface ResolvedForm {
  /** The ordered editable fields. */
  fields: FieldSpec[];
  /** Which strategy produced them. */
  source: FormSource;
  /** The matched typed-viewer id, when `source === "typed-view"`. */
  viewerId?: string;
}

export interface ResolveFormOptions {
  /** A parsed `ui:` form description dataset (overrides everything when present). */
  formDataset?: DatasetCore;
  /** The form's root subject within `formDataset` (auto-discovered when omitted). */
  formSubject?: string;
  /** The Type-Index category id the resource was discovered under (selection hint). */
  categoryId?: string;
}

/**
 * Resolve the editable field set for `subject` inside `dataset`. `dataset` is
 * the resource being edited; `opts.formDataset` (if any) is a separate `ui:`
 * form description.
 */
export function resolveForm(
  _url: string,
  dataset: DatasetCore,
  subject: string | Term,
  opts: ResolveFormOptions = {},
): ResolvedForm {
  // 1. An authored ui: form wins.
  if (opts.formDataset) {
    const fields = bindPredicates(
      parseUiForm(opts.formDataset, opts.formSubject),
      dataset,
      subject,
    );
    if (fields.length > 0) return { fields, source: "ui-form" };
  }

  // 2. A first-party typed-view edit map, when a known viewer matches.
  const types = subjectOf(dataset, subject).types.map(canonicalize);
  const viewers: readonly (readonly [string, string])[] = [
    ["contacts", `${NS.VCARD}Individual`],
    ["music", `${NS.SCHEMA}MusicRecording`],
    ["photo", `${NS.SCHEMA}ImageObject`],
    ["photo", `${NS.SCHEMA}Photograph`],
    ["event", `${NS.SCHEMA}Event`],
    ["bookmark", "http://www.w3.org/2002/01/bookmark#Bookmark"],
    ["bookmark", `${NS.BOOKMARK}Bookmark`],
  ];
  const viewerId = viewers.find(([, type]) => types.includes(type))?.[0];
  if (viewerId) {
    const node = subjectOf(dataset, subject);
    const titlePredicate = [
      `${NS.SCHEMA}name`,
      `${NS.DCT}title`,
      `${NS.VCARD}fn`,
      `${NS.FOAF}name`,
      `${NS.RDFS}label`,
    ].find((predicate) => node.texts(predicate).length);
    const fields = (editFieldsFor(viewerId) as readonly FieldSpec[]).map((field) =>
      titlePredicate && ["Name", "Title"].includes(field.label)
        ? { ...field, predicate: titlePredicate }
        : field,
    );
    return { fields: bindPredicates(fields, dataset, subject), source: "typed-view", viewerId };
  }

  // 3. Auto-generate from the subject's own properties.
  return { fields: autoFormFor(dataset, subject), source: "auto" };
}

/** Bind canonical fields to the vocabulary spelling actually present on this subject. */
function bindPredicates(
  fields: readonly FieldSpec[],
  dataset: DatasetCore,
  subject: string | Term,
): FieldSpec[] {
  const term = subjectOf(dataset, subject);
  const predicates = [...dataset.match(TermAs.term(term))].map((quad) => quad.predicate.value);
  return fields.map((field) => ({
    ...field,
    predicate:
      predicates.find((predicate) => canonicalize(predicate) === canonicalize(field.predicate)) ??
      field.predicate,
  }));
}
