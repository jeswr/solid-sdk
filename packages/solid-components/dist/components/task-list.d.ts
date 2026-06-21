import { type TemplateResult } from "lit";
import { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/**
 * A read-only `wf:Task` list element.
 *
 * (No `@solid-shape`: the model's SHACL shape is an anonymous `sh:NodeShape` with a
 * `sh:targetClass wf:Task`, so there is no canonical shape IRI to advertise. The
 * `@solid-class` target class is the binding key the resolver maps on.)
 *
 * @solid-class http://www.w3.org/2005/01/wf/flow#Task
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list    - The <ul> wrapping the tasks.
 * @csspart task    - One task <li>.
 * @csspart title   - A task's title.
 * @csspart state   - A task's open/closed state badge.
 * @csspart meta    - A task's metadata row (assignee / due / priority).
 * @csspart empty   - Placeholder when the graph holds no tasks.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export declare class JeswrTaskList extends AbstractReadElement {
    #private;
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(graph: Store): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-task-list": JeswrTaskList;
    }
}
