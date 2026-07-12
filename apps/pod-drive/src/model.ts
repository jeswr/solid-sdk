// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed RDF model for the Pod Drive file/folder browser.
//
// We BUILD ON @solid/object's existing, sanctioned wrappers (`ContainerDataset`,
// `Container`, `Resource`) rather than reinventing container reading — the house
// rule is "check @solid/object before writing your own wrapper". `Resource`
// already exposes id / isContainer / name / size / modified / mtime / type /
// mimeType over an n3.Store; we only add the Pod-Drive-specific reads it lacks:
//   - `contentType` from `dcterms:format` (a plain string, not the IANA-class
//     `mimeType` @solid/object derives from rdf:type),
//   - a posix:mtime *epoch-integer* fallback (some servers emit an xsd:integer,
//     not the xsd:dateTime @solid/object's `mtime` getter expects),
//   - DriveRoot detection (poddrive:DriveRoot type),
// plus folder-first sorted listing on the container.
//
// All reads go through @rdfjs/wrapper typed accessors (OptionalFrom / SetFrom /
// TermAs.instance) — never hand-parsed quads. Reads never throw on absent /
// wrong-typed data: a missing posix:size reports `undefined`.

import type { DatasetCore, Term } from "@rdfjs/types";
import { LiteralAs, OptionalFrom, SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { Container, ContainerDataset, Resource } from "@solid/object";
import { DataFactory } from "n3";
import { DCTERMS, LDP, PODDRIVE, POSIX } from "./vocab.js";

/**
 * Run a read that may throw on absent / wrong-typed data and degrade to
 * `undefined`. @rdfjs/wrapper throws (TermTypeError / LiteralDatatypeError)
 * when the object is e.g. an IRI where a literal is expected, or a literal of
 * the wrong datatype; real pods are inconsistent, so the model treats those the
 * same as a missing value rather than crashing a directory listing.
 */
function safeOptional<T>(fn: () => T | undefined): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Read a single literal-valued string for `predicate` on `subject`, or
 * `undefined` if absent. Unlike `LiteralAs.string` (which returns `.value` for
 * ANY term, including a NamedNode), this enforces that the object is a Literal —
 * so an IRI-valued `dcterms:format` is rejected, not silently returned as text.
 */
function literalString(subject: Term, predicate: string, dataset: DatasetCore): string | undefined {
  for (const q of dataset.match(subject, DataFactory.namedNode(predicate), null)) {
    if (q.object.termType === "Literal") {
      return q.object.value;
    }
  }
  return undefined;
}

/**
 * A single entry (file OR sub-container) in a drive listing — extends
 * @solid/object's `Resource` with Pod-Drive-specific metadata reads.
 */
export class DriveResource extends Resource {
  /** The resource IRI (its URL on the pod). Alias of `id` for readability. */
  get url(): string {
    return this.id;
  }

  /**
   * Byte size from `posix:size`, when present — a safe override of
   * @solid/object's `Resource.size` that degrades to `undefined` on a
   * wrong-typed value (an IRI / non-numeric literal) instead of throwing.
   */
  override get size(): number | undefined {
    return safeOptional(() => super.size);
  }

  /**
   * Content type from `dcterms:format` (a literal like "image/png"), when the
   * server exposes it. Distinct from @solid/object's `mimeType`, which is
   * derived from an IANA media-type *class* in `rdf:type` and is absent on most
   * servers' container listings. Only a literal value is accepted.
   */
  get contentType(): string | undefined {
    return literalString(this as Term, DCTERMS.format, this.dataset);
  }

  /**
   * Last-modified time, widened beyond @solid/object's `lastModified`
   * (dcterms:modified → posix:mtime-as-dateTime) to also accept a posix:mtime
   * expressed as an epoch-seconds *integer*, which several servers emit. Robust
   * to wrong-typed values: a bad mtime degrades to `undefined`.
   */
  get modifiedAt(): Date | undefined {
    const known = safeOptional(() => this.lastModified);
    if (known !== undefined) {
      return known;
    }
    const epoch = safeOptional(() =>
      OptionalFrom.subjectPredicate(this, POSIX.mtime, LiteralAs.number),
    );
    return epoch === undefined ? undefined : new Date(epoch * 1000);
  }

  /** True when this resource is registered as a Pod Drive root container. */
  get isDriveRoot(): boolean {
    return this.type.has(PODDRIVE.DriveRoot);
  }
}

/**
 * An LDP container — the "folder" being browsed. Extends @solid/object's
 * `Container` so its children are typed as {@link DriveResource}s and adds a
 * stable, folder-first sorted listing.
 */
export class DriveContainer extends Container {
  /** The container IRI. Alias of `id`. */
  get url(): string {
    return this.id;
  }

  /**
   * Direct children as typed {@link DriveResource}s via `ldp:contains`.
   * Overrides `Container.contains` only to widen the element type; the
   * membership predicate and dataset are unchanged.
   */
  override get contains(): Set<DriveResource> {
    return SetFrom.subjectPredicate(
      this,
      LDP.contains,
      TermAs.instance(DriveResource),
      TermFrom.instance,
    );
  }

  /**
   * Children as a stable, sorted array: folders first, then files, each group
   * alphabetically by name (locale-aware). The browser-friendly listing.
   */
  get entries(): DriveResource[] {
    return [...this.contains].sort((a, b) => {
      if (a.isContainer !== b.isContainer) {
        return a.isContainer ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
}

/** A `ContainerDataset` whose `container` is a {@link DriveContainer}. */
export class DriveContainerDataset extends ContainerDataset {
  /**
   * The drive container at the document's `ldp:contains` subject. Returns
   * `undefined` only when the dataset names no container subject — but
   * {@link readContainer} anchors explicitly at the requested URL, so prefer it.
   */
  override get container(): DriveContainer | undefined {
    const base = super.container;
    if (base === undefined) {
      return undefined;
    }
    return new DriveContainer(base.id, this, DataFactory);
  }
}

/**
 * Read the container at `url` out of a fetched dataset.
 *
 * The dataset is whatever `@jeswr/fetch-rdf` returned for a GET on the
 * container; the server's listing (`ldp:contains` + per-child posix/dcterms
 * metadata) is the source of truth. Returns a {@link DriveContainer} anchored
 * at the requested URL — even if the dataset asserts nothing about it (an empty
 * container then has zero entries).
 */
export function readContainer(url: string, dataset: DatasetCore): DriveContainer {
  return new DriveContainer(url, dataset, DataFactory);
}

/** Narrowing helper: a {@link DriveResource} known to be a folder. */
export function isFolder(r: DriveResource): boolean {
  return r.isContainer;
}

/** The named-node subject term for a resource URL — used by writers. */
export function resourceSubject(url: string) {
  return DataFactory.namedNode(url);
}
