// AUTHORED-BY Codex (GPT-6.1 Sol)
// Public types retained from the original Task model.
/**
 * The lifecycle state of a task. The wire model is a binary open/closed
 * (`rdf:type wf:Open` / `wf:Closed`) so it federates cleanly: any consumer maps a
 * task to one of these two. An "in-progress" band is an app-local refinement
 * (carried as an extra producer-scoped `rdf:type` subclass) and is NOT part of
 * this shared model — a foreign consumer still sees `wf:Open` and is correct.
 */
export type TaskState = "open" | "closed";

/** Task priority. Optional; carried via `schema:priority` text for cross-app legibility. */
export type TaskPriority = "high" | "medium" | "low";

/**
 * A federated task as a plain, serialisable object — the shape an app's UI works
 * with. Mirrors the union of the fields solid-issues and the Pod Manager already
 * read/write, so this is their common data model, not a third one.
 */
export interface TaskData {
  /** `dct:title` — the one required field. */
  title: string;
  /** `wf:description` — the body. */
  description?: string;
  /** Lifecycle state — `rdf:type wf:Open` / `wf:Closed`. */
  state: TaskState;
  /** `dct:created`. */
  created?: Date;
  /** `dct:modified`. */
  modified?: Date;
  /** `prov:endedAtTime` — completion time, set on close, cleared on reopen. */
  endedAt?: Date;
  /** `dct:creator` — the author's WebID. */
  creator?: string;
  /** `wf:assignee` — the assigned agent's WebID. */
  assignee?: string;
  /** `wf:tracker` — the project / tracker document this task belongs to. */
  project?: string;
  /** `wf:dateDue` — the due date. */
  dueDate?: Date;
  /** `schema:priority` — high/medium/low. */
  priority?: TaskPriority;
  /** `schema:position` — backlog rank; lower sorts first. */
  rank?: number;
  /** `dct:isPartOf` — the parent issue (this is a sub-task of it). */
  parent?: string;
  /** `dct:requires` — issues that must be done first (this is blocked by them). */
  blockedBy?: string[];
  /** `dct:relation` — non-blocking, symmetric relates-to links. */
  relatesTo?: string[];
  /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
  duplicateOf?: string;
  /** `prov:wasDerivedFrom` — the single original this task was cloned from. */
  clonedFrom?: string;
}
