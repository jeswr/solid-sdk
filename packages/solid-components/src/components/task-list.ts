// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-task-list> — a READ-ONLY list of `wf:Task` resources, bound to the shared
// `@jeswr/solid-task-model`. It reads a container (or any RDF document) through the
// Phase-1 DataController and renders every `wf:Task` subject it finds, via the
// model's TYPED `Task` accessor — never a hand-built quad query for the fields.
//
// RDF DISCIPLINE: the only direct quad read is "which subjects are typed wf:Task"
// (an existence query — no triple is built), exactly mirroring Pod-Manager's
// `collectTypes`/typed-views selection (src/lib/typed-views/select.ts, cited in
// resolver.ts). Each task's FIELDS are read through `@jeswr/solid-task-model`'s
// `Task` wrapper (`@rdfjs/wrapper` typed accessors), so the field mapping is the
// single shared model, not a re-implementation.
//
// XSS: every untrusted literal (title, description, assignee text…) is rendered via
// Lit text interpolation, which escapes. No `unsafeHTML`. (There are no link hrefs
// here — the assignee WebID is shown as text in Phase-1; a profile link is the
// <jeswr-profile-card> composition's job.)

import { Task } from "@jeswr/solid-task-model/task";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { DataController } from "../data-controller.js";
import { RDF_TYPE, TASK_CLASS } from "../vocab.js";
import { AbstractReadElement, formatDate } from "./shared.js";

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
export class JeswrTaskList extends AbstractReadElement {
  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    // A task list reads the document/container as a single graph (the tasks may be
    // inline in a container index, or this may be one task document). We read the
    // whole graph and enumerate wf:Task subjects from it — no per-child fetch in
    // Phase-1 (a deep listing that fetches each child is a documented follow-up).
    const result = await controller.read(src, publicRead ? { public: true } : {});
    // `read` returns a dataset on any 2xx (no etag is sent here, so never a 304).
    // The empty-store fallback is defensive only (unreachable without a conditional).
    return { graph: result.dataset ?? new Store(), baseUrl: result.url };
  }

  protected override renderReady(graph: Store): TemplateResult {
    const tasks = collectTasks(graph);
    if (tasks.length === 0) {
      return html`<slot name="empty"><p part="empty">No tasks.</p></slot>`;
    }
    return html`
      <ul part="list">
        ${tasks.map((t) => this.#renderTask(t))}
      </ul>
    `;
  }

  #renderTask(task: Task): TemplateResult {
    const meta: string[] = [];
    if (task.assignee) meta.push(`Assignee: ${task.assignee}`);
    if (task.priority) meta.push(`Priority: ${task.priority}`);
    const due = formatDate(task.dueDate);
    if (due) meta.push(`Due: ${due}`);
    return html`
      <li part="task" data-state=${task.state}>
        <span part="title">${task.title ?? "(untitled task)"}</span>
        <span part="state" data-state=${task.state}>${task.state}</span>
        ${task.description ? html`<p>${task.description}</p>` : null}
        ${meta.length > 0 ? html`<small part="meta">${meta.join(" · ")}</small>` : null}
      </li>
    `;
  }
}

/**
 * Collect every `wf:Task`-typed subject in the graph as a typed {@link Task} wrapper.
 * The subject scan is the ONLY direct quad read (an existence query, no triple
 * built); all field access goes through the model wrapper. De-duplicated by subject
 * IRI, preserving first-seen order. Mirrors PM's `collectTypes` subject discovery.
 */
function collectTasks(graph: Store): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const quad of graph.getQuads(null, DataFactory.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== TASK_CLASS) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Task(subject, graph, DataFactory));
  }
  return out;
}

if (!customElements.get("jeswr-task-list")) {
  customElements.define("jeswr-task-list", JeswrTaskList);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-task-list": JeswrTaskList;
  }
}
