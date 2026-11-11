// AUTHORED-BY Codex (GPT-6.1 Sol)
/** A single saved revision as the UI consumes it (plain, serialisable). */
export interface Revision {
  /** The revision entity's URL (`<resource>#rev-<n>`). */
  id: string;
  label?: string | undefined;
  /** The body snapshot at this revision. */
  body: string;
  /** The body's content format (a media-type string). */
  format: string;
  /** When this revision was generated — ISO-8601 string (serialisable). */
  generatedAt: string;
  /** The editor WebID this revision is attributed to, if recorded. */
  attributedTo?: string | undefined;
  /** The predecessor revision's URL, if this is not the first. */
  wasRevisionOf?: string | undefined;
}

/** A document as the UI consumes it (plain, serialisable). */
export interface PodDocument {
  /** Stable resource identity, retained across renames and log recovery. */
  instanceId?: string | undefined;
  /** Title — `dct:title`. */
  updateLog?: string | undefined;
  assets?: string | undefined;
  comments?: string | undefined;
  wordCount?: number | undefined;
  wasDerivedFrom?: string | undefined;
  title: string;
  /** The current rich-text body — `pd:body`. */
  body: string;
  /** The body's content format — `pd:format` (defaults to `text/html`). */
  format: string;
  /** Authoring WebID — `dct:creator` (an IRI). */
  creator?: string | undefined;
  /** Created stamp — `dct:created`, ISO-8601 string. */
  created?: string | undefined;
  /** Last-modified stamp — `dct:modified`, ISO-8601 string. */
  modified?: string | undefined;
  /**
   * The full revision history, head-first (newest → oldest), reconstructed by
   * walking `pd:currentRevision` then `prov:wasRevisionOf`. Empty for a document
   * with no recorded history.
   */
  revisions: Revision[];
}

/** Input for {@link buildDocument} — the current state plus its prior history. */
export interface BuildDocumentInput {
  instanceId?: string | undefined;
  /** Revision author, separate from the original document creator. */
  editor?: string | undefined;
  updateLog?: string | undefined;
  assets?: string | undefined;
  comments?: string | undefined;
  wordCount?: number | undefined;
  wasDerivedFrom?: string | undefined;
  /** A nonblank label always records a revision, even for unchanged content. */
  revisionLabel?: string | undefined;
  title: string;
  /** The rich-text body; defaults to the empty string for a brand-new doc. */
  body?: string | undefined;
  /** Body content format; defaults to `text/html` when omitted/blank. */
  format?: string | undefined;
  /** Authoring WebID (an IRI). Also attributed to the new head revision. */
  creator?: string | undefined;
  /**
   * Created stamp; defaults to `now` for a brand-new document. On a SAVE, pass
   * back the document's existing `created` (a `Date` or the ISO string from a
   * prior {@link parseDocument}) so the original creation time is preserved
   * rather than silently rewritten to the edit time.
   */
  created?: Date | string | undefined;
  /**
   * Prior revisions to preserve, head-first (newest → oldest) — typically the
   * `revisions` array from the document just read. A head revision capturing
   * the supplied `body`/`format` is prepended according to the revision policy; pass `[]` for a
   * brand-new document.
   */
  priorRevisions?: readonly Revision[] | undefined;
  /** "Now" — injectable for deterministic tests; defaults to a real `new Date()`. */
  now?: Date | undefined;
}
