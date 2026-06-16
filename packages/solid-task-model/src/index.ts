// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `@jeswr/solid-task-model` — the SHARED federated Task/Issue RDF model for the
 * Solid app suite.
 *
 * One model that the Pod Manager, solid-issues, and the pod-apps all read and
 * write, so a task created in one shows up — assignee, status, due date and all —
 * in the others. Built on reused, dereferenceable standard vocabulary
 * (`wf:Task` + Dublin Core + schema.org + PROV-O) per ADR-0013 and the R9
 * data-federation recommendation, with a SHACL shape that pins the contract.
 *
 * @packageDocumentation
 */

export {
  TASK_SHAPE_PATH,
  TRACKER_SHAPE_PATH,
  taskShapeTtl,
  trackerShapeTtl,
} from "./shape.js";
export {
  buildTask,
  isAssignedTo,
  isHttpIri,
  PRIORITIES,
  parseTask,
  parseTaskTtl,
  serializeTask,
  sortTasks,
  storeToTurtle,
  Task,
  type TaskData,
  type TaskPriority,
  type TaskState,
  taskSubject,
} from "./task.js";
export {
  buildTracker,
  canTransition,
  DEFAULT_WORKFLOW,
  parseTracker,
  parseTrackerTtl,
  type StatusSlug,
  serializeTracker,
  statusState,
  Tracker,
  type TrackerData,
  trackerSubject,
  type WorkflowDef,
  type WorkflowStatus,
} from "./tracker.js";
export {
  DCT,
  dct,
  PREFIXES,
  PROV,
  prov,
  RDF,
  RDF_TYPE,
  RDFS,
  rdf,
  rdfs,
  SCHEMA,
  schema,
  TASK_CLASS,
  VCARD,
  vcard,
  WF,
  WF_ALLOWED_TRANS,
  WF_ASSIGNEE_GROUP,
  WF_CLOSED,
  WF_INITIAL_STATE,
  WF_ISSUE_CATEGORY,
  WF_ISSUE_CLASS,
  WF_OPEN,
  WF_STATE,
  WF_STATE_STORE,
  WF_TRACKER,
  wf,
  XSD,
  xsd,
} from "./vocab.js";
