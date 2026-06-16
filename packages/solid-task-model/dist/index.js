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
export { TASK_SHAPE_PATH, taskShapeTtl } from "./shape.js";
export { buildTask, isAssignedTo, isHttpIri, PRIORITIES, parseTask, parseTaskTtl, serializeTask, sortTasks, storeToTurtle, Task, taskSubject, } from "./task.js";
export { DCT, dct, PREFIXES, PROV, prov, RDF, RDF_TYPE, RDFS, rdf, rdfs, SCHEMA, schema, TASK_CLASS, WF, WF_CLOSED, WF_OPEN, wf, XSD, xsd, } from "./vocab.js";
//# sourceMappingURL=index.js.map