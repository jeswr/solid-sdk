// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  addIssueComment,
  IssueItem,
  IssuesTracker,
  issueComments,
  syncIssueState,
} from "../../src/apps/tasks/lib/issues/model";
import { DataFactory, NS, node, parse, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { issuesFixture } from "./tasks-issues-fixtures";

const url = "https://pod.example/issue-tracker/issues/old.ttl";
const tracker = "https://pod.example/issue-tracker/tracker.ttl";
const fixture = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
@prefix dct: <http://purl.org/dc/terms/>.
<#this> a wf:Task, wf:Open, <${tracker}#priority-high>, <${tracker}#label-bug>, <${tracker}#status-in-progress>;
dct:title "Legacy issue"; wf:description "Original body"; wf:tracker <${tracker}#this>;
<https://example.org/unknown> [ <https://example.org/value> "Keep me" ];
wf:message <#message>.
<#message> a wf:Message; <http://rdfs.org/sioc/ns#content> "Existing comment";
<http://xmlns.com/foaf/0.1/maker> <https://bob.example/#me>;
dct:created "2026-01-01T12:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`;

describe("Issues wire compatibility", () => {
  it("supports unassigned priorities, partial comments and an empty workflow", async () => {
    const dataset = new Store();
    const item = new IssueItem(`${url}#it`, dataset, DataFactory);
    item.priority = "medium";
    expect(item.priority).toBe("medium");
    item.priority = undefined;
    expect(item.priority).toBeUndefined();
    item.project = `${tracker}#this`;
    item.priority = undefined;
    const wrapped = new IssuesTracker(`${tracker}#this`, dataset, DataFactory);
    wrapped.stateStore = "https://pod.example/custom/";
    expect(wrapped.stateStore).toBe("https://pod.example/custom/");
    const missing = node(`${url}#empty`, dataset);
    node(item.id, dataset).nodes(`${NS.WF}message`).add(missing);
    const noDate = node(`${url}#no-date`, dataset);
    noDate.setText(`${NS.SIOC}content`, "Undated");
    node(item.id, dataset).nodes(`${NS.WF}message`).add(noDate);
    expect(issueComments(item).map((comment) => comment.content)).toEqual(["", "Undated"]);
    addIssueComment(item, " ", "https://pod.example/#me", "blank", new Date());
    expect(issueComments(item)).toHaveLength(2);
    const { project } = await issuesFixture();
    vi.spyOn(project.tracker, "workflow", "get").mockReturnValue({ statuses: [], transitions: {} });
    syncIssueState(item, project);
    expect(item.types.has(`${tracker}#status-todo`)).toBe(false);
  });
  it("edits the legacy subject, mirrors priority, and preserves foreign RDF and comments", async () => {
    const dataset = await parse(url, fixture);
    const issue = new IssueItem(`${url}#this`, dataset, DataFactory);
    expect(issue.priority).toBe("high");
    issue.title = "Edited in Tasks";
    issue.description = "New body";
    issue.priority = "low";
    expect(issue.types.has(`${tracker}#priority-high`)).toBe(false);
    expect(issue.types.has(`${tracker}#priority-low`)).toBe(true);
    expect(issueComments(issue)[0]?.content).toBe("Existing comment");
    addIssueComment(
      issue,
      "A reply",
      "https://alice.example/#me",
      "reply",
      new Date("2026-01-02Z"),
    );
    const reread = await parse(url, await serialize(dataset));
    const shared = new IssueItem(`${url}#this`, reread, DataFactory);
    expect(shared.title).toBe("Edited in Tasks");
    expect(shared.description).toBe("New body");
    expect(shared.priority).toBe("low");
    expect(issueComments(shared).map((comment) => comment.content)).toEqual([
      "Existing comment",
      "A reply",
    ]);
    expect(
      [...reread.match(null, DataFactory.namedNode("https://example.org/value"))][0]?.object.value,
    ).toBe("Keep me");
    expect(
      [
        ...reread.match(
          DataFactory.namedNode(shared.id),
          DataFactory.namedNode(`${NS.DCT}description`),
        ),
      ][0]?.object.value,
    ).toBe("New body");
  });
});
