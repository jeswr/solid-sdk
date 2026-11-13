// AUTHORED-BY Codex GPT-6.1-Sol

import { documentUrl, NS, node } from "../model/rdf";
import type { StoredProject } from "../model/store";
import { TaskItem } from "../model/task";
import { TaskTracker } from "../model/tracker";

export const issuesContainer = (url: string) => new URL("issues/", documentUrl(url)).href;
export function isIssuesProject(project: StoredProject): boolean {
  return (
    project.tracker.categories.has(`${project.url}#Priority`) ||
    new URL(project.url).pathname.includes("/issue-tracker/") ||
    !node(project.tracker.id, project.dataset).iri(`${NS.WF}stateStore`)
  );
}
/** The standalone app derives this sibling container rather than writing stateStore. */
export class IssuesTracker extends TaskTracker {
  override get stateStore() {
    return super.stateStore ?? issuesContainer(this.id);
  }
  override set stateStore(value: string | undefined) {
    super.stateStore = value;
  }
}
/** Keep the standalone category and the shared literal consistent through every Tasks editor. */
export class IssueItem extends TaskItem {
  override get priority() {
    const base = this.project && documentUrl(this.project);
    return (
      (["high", "medium", "low"] as const).find((level) =>
        this.types.has(`${base}#priority-${level}`),
      ) ?? super.priority
    );
  }
  override set priority(value: "high" | "medium" | "low" | undefined) {
    super.priority = value;
    if (!this.project) return;
    const prefix = `${documentUrl(this.project)}#priority-`;
    for (const level of ["high", "medium", "low"]) this.types.delete(`${prefix}${level}`);
    if (value) this.types.add(`${prefix}${value}`);
  }
}
export function issueComments(task: TaskItem) {
  return [...node(task.id, task.dataset).nodes(`${NS.WF}message`)]
    .map((comment) => ({
      id: comment.value,
      content: comment.text(`${NS.SIOC}content`) ?? "",
      author: comment.iri(`${NS.FOAF}maker`),
      created: comment.date(`${NS.DCT}created`),
    }))
    .sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0));
}
export function addIssueComment(
  task: TaskItem,
  content: string,
  author: string,
  id: string,
  now: Date,
): void {
  if (!content.trim()) return;
  const comment = node(`${documentUrl(task.id)}#msg-${id}`, task.dataset);
  comment.types.add(`${NS.WF}Message`);
  comment.setText(`${NS.SIOC}content`, content.trim());
  comment.setIri(`${NS.FOAF}maker`, author);
  comment.setDate(`${NS.DCT}created`, now);
  node(task.id, task.dataset).nodes(`${NS.WF}message`).add(comment);
}
/** Binary changes must also move the standalone workflow badge out of its previous state. */
export function syncIssueState(task: TaskItem, project: StoredProject): void {
  const prefix = `${project.url}#status-`;
  const workflow = project.tracker.workflow;
  const target = workflow.statuses.find((status) => status.terminal === (task.state === "closed"));
  for (const type of [...task.types]) if (type.startsWith(prefix)) task.types.delete(type);
  if (target) task.types.add(`${prefix}${target.slug}`);
}
