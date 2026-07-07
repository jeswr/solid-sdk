/** Filesystem path to the focused scheduling SHACL shape (`scheduling.shacl.ttl`). */
export declare const SCHEDULING_SHAPE_PATH: string;
/** Filesystem path to the federation-extension proposal candidates (`scheduling.proposals.ttl`). */
export declare const SCHEDULING_PROPOSALS_PATH: string;
/**
 * The focused `sched:Task` / `sched:Calendar` scheduling SHACL shape, as a Turtle
 * string. Cached after the first read. Pass it (with the data graph) to a SHACL
 * validator — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export declare function schedulingShapeTtl(): string;
/**
 * The `fedcon:Proposal` CANDIDATES for the scheduling-sector gaps this fork's real
 * task data surfaced (kanban bucket/board position, first-class labels,
 * task-relations, percent-done, and the CalendarEvent↔dav-bridge reconciliation),
 * as a Turtle string. Cached after the first read. These are CANDIDATES — not yet
 * POSTed to any registry; the sector `.ttl` is never edited here. See
 * `DECISIONS.md`.
 */
export declare function schedulingProposalsTtl(): string;
//# sourceMappingURL=shape.d.ts.map