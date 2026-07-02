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
  type AddressBookData,
  addressBookSubject,
  buildAddressBook,
  buildGroup,
  buildGroupsIndex,
  buildPeopleIndex,
  buildPerson,
  Contact,
  ContactBook,
  type ContactData,
  ContactGroup,
  type ContactGroupData,
  groupSubject,
  parseAddressBook,
  parseAddressBookTtl,
  parseGroup,
  parseGroupTtl,
  parsePerson,
  parsePersonTtl,
  personSubject,
  serializeAddressBook,
  serializeGroup,
  serializeGroupsIndex,
  serializePeopleIndex,
  serializePerson,
} from "./contacts.js";
// NOTE: the `node:fs`/`node:url`-using shape helpers (`taskShapeTtl`,
// `trackerShapeTtl`, `addressBookShapeTtl`, `TASK_SHAPE_PATH`,
// `TRACKER_SHAPE_PATH`, `CONTACTS_SHAPE_PATH`) live ONLY behind the `./shape`
// subpath, never here. This barrel must stay bundlable by a browser bundler
// (Vite/Turbopack/esbuild) with `platform: "browser"` — re-exporting even one
// Node-only symbol here would poison EVERY consumer of the root entry with a
// `node:fs`/`node:url` import, including one that only wants a pure vocab
// const (this happened via `@jeswr/solid-chat-interop`'s `vocab.ts`, which
// re-exports `TASK_CLASS`/`WF_CLOSED`/`WF_OPEN`/`wf` from here — a transitive
// consumer's browser build broke even though it never touched a shape
// helper). See `src/browser-bundle.test.ts` for the regression test and
// `./shape`'s module doc for the server-only half.
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
  ACL,
  acl,
  DC,
  DCT,
  dc,
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
  VCARD_ADDRESS_BOOK,
  VCARD_CELL,
  VCARD_FN,
  VCARD_GROUP,
  VCARD_GROUP_INDEX,
  VCARD_HAS_EMAIL,
  VCARD_HAS_MEMBER,
  VCARD_HAS_TELEPHONE,
  VCARD_HAS_UID,
  VCARD_HOME,
  VCARD_IN_ADDRESS_BOOK,
  VCARD_INCLUDES_GROUP,
  VCARD_INDIVIDUAL,
  VCARD_NAME_EMAIL_INDEX,
  VCARD_NOTE,
  VCARD_ORGANIZATION_NAME,
  VCARD_URL,
  VCARD_VALUE,
  VCARD_WEB_ID,
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
