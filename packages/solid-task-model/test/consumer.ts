// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { Task, type TaskData, type TaskPriority, type TaskState } from "../dist/task.js";

const view = new Task("https://pod.example/task#it", new Store(), DataFactory);
const chained: Task = view.mark();
const wrapper: TermWrapper = chained;
void wrapper;
const priority: TaskPriority | undefined = view.priority;
const state: TaskState = view.state;
const data: TaskData = { title: "T", state };
void [priority, data];
view.title = undefined;
view.description = undefined;
view.created = undefined;
view.modified = undefined;
view.endedAt = undefined;
view.creator = undefined;
view.assignee = undefined;
view.project = undefined;
view.dueDate = undefined;
view.priority = undefined;
view.rank = undefined;
view.parent = undefined;
view.duplicateOf = undefined;
view.clonedFrom = undefined;
// @ts-expect-error The public priority union must stay closed.
view.priority = "urgent";
// @ts-expect-error The public lifecycle union must stay closed.
view.state = "in-progress";
// @ts-expect-error Internal generated fields are not part of the public type.
void view.descriptionDct;
