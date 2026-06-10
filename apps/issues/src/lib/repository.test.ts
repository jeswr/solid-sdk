import { describe, it, expect } from "vitest";
import { Repository } from "./repository";
import { fakePod } from "./testing/fake-pod";

const POD = "http://localhost:3000/alice/";
const TRACKER = `${POD}issue-tracker/tracker.ttl`;
const CONTAINER = `${POD}issue-tracker/issues/`;
const ME = `${POD}profile/card#me`;

describe("Repository (per-issue documents)", () => {
  it("creates each issue as its own document and lists them newest-first", async () => {
    const { impl, store } = fakePod();
    const repo = new Repository(TRACKER, impl);

    const a = await repo.create({ title: "First", creator: ME, priority: "high", labels: ["bug"] });
    const b = await repo.create({ title: "Second", creator: ME });

    expect(a.startsWith(CONTAINER)).toBe(true);
    expect(a.endsWith(".ttl")).toBe(true);
    expect(a).not.toBe(b);
    // tracker config doc was created with priority classes.
    expect(store.get(TRACKER)).toContain("Tracker");
    expect(store.get(TRACKER)).toContain("priority-high");

    const { issues } = await repo.list();
    expect(issues.map((i) => i.title)).toEqual(["Second", "First"]);
    const first = issues.find((i) => i.title === "First")!;
    expect(first.priority).toBe("high");
    expect(first.labels).toEqual(["bug"]);
    expect(first.state).toBe("open");
    expect(first.canWrite).toBe(true);
  });

  it("updates, toggles state, and removes a single issue document", async () => {
    const { impl, store } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const url = await repo.create({ title: "Bug", creator: ME });

    await repo.update(url, { title: "Fixed title", priority: "low" });
    await repo.setState(url, "closed");
    let { issues } = await repo.list();
    expect(issues[0].title).toBe("Fixed title");
    expect(issues[0].priority).toBe("low");
    expect(issues[0].state).toBe("closed");

    await repo.remove(url);
    expect(store.has(url)).toBe(false);
    ({ issues } = await repo.list());
    expect(issues).toHaveLength(0);
  });

  it("adds comments to an issue", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const url = await repo.create({ title: "Discuss", creator: ME });

    await repo.addComment(url, "First comment", ME);
    await repo.addComment(url, "Second comment", ME);

    const { issues } = await repo.list();
    const comments = issues[0].comments;
    expect(comments.map((c) => c.content)).toEqual(["First comment", "Second comment"]);
    expect(comments[0].author).toBe(ME);
  });

  it("creates sprints, moves issues between them, and runs the lifecycle", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const a = await repo.create({ title: "Story A", creator: ME, estimate: 3 });
    const b = await repo.create({ title: "Story B", creator: ME, estimate: 5 });

    const s1 = await repo.createSprint("Sprint 1");
    const s2 = await repo.createSprint("Sprint 2");
    await repo.setSprintMembership(s1, a, true);
    await repo.setSprintMembership(s1, b, true);
    // Moving B into sprint 2 removes it from sprint 1 (one sprint per issue).
    await repo.setSprintMembership(s2, b, true);

    let sprints = await repo.listSprints();
    expect(sprints.map((s) => s.title)).toEqual(["Sprint 1", "Sprint 2"]);
    expect(sprints.find((s) => s.title === "Sprint 1")?.taskUrls).toEqual([a]);
    expect(sprints.find((s) => s.title === "Sprint 2")?.taskUrls).toEqual([b]);
    expect(sprints.every((s) => s.state === "planned")).toBe(true);

    await repo.startSprint(s1);
    sprints = await repo.listSprints();
    expect(sprints.find((s) => s.title === "Sprint 1")?.state).toBe("active");
    // active sorts before planned
    expect(sprints[0].title).toBe("Sprint 1");

    await repo.completeSprint(s1);
    sprints = await repo.listSprints();
    expect(sprints.find((s) => s.title === "Sprint 1")?.state).toBe("done");

    // Estimates round-trip onto records.
    const { issues } = await repo.list();
    expect(issues.find((i) => i.url === a)?.estimate).toBe(3);
  });

  it("releases unfinished issues back to the backlog when a sprint completes", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const doneIssue = await repo.create({ title: "Done one", creator: ME, estimate: 3 });
    const openIssue = await repo.create({ title: "Still open", creator: ME, estimate: 5 });
    await repo.setStatus(doneIssue, "done");

    const sprint = await repo.createSprint("Sprint X");
    await repo.setSprintMembership(sprint, doneIssue, true);
    await repo.setSprintMembership(sprint, openIssue, true);
    await repo.startSprint(sprint);
    await repo.completeSprint(sprint, [openIssue]); // caller passes unfinished work

    const sprints = await repo.listSprints();
    const done = sprints.find((s) => s.iri === sprint)!;
    expect(done.state).toBe("done");
    expect(done.taskUrls).toEqual([doneIssue]); // open issue released to backlog
    expect(done.committedPoints).toBe(8); // 3 + 5, snapshotted before the release
  });

  it("round-trips custom-field values through create, update, and list", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.ensureTracker();
    const stage = await repo.defineField("Stage", "select", ["Alpha", "Beta"]);
    await repo.defineField("Team", "text");

    const url = await repo.create({
      title: "Field-bearing",
      creator: ME,
      fields: { stage: stage.options[0].iri, team: "Platform" },
    });
    let { issues } = await repo.list();
    expect(issues[0].fields).toEqual({ stage: stage.options[0].iri, team: "Platform" });

    // Update one field, clear the other; unknown slugs are ignored.
    await repo.update(url, { fields: { stage: stage.options[1].iri, team: undefined, ghost: "x" } });
    ({ issues } = await repo.list());
    expect(issues[0].fields).toEqual({ stage: stage.options[1].iri });

    // Removing the definition hides values from records (data stays put).
    await repo.removeField("stage");
    expect((await repo.info()).fields.map((f) => f.slug)).toEqual(["team"]);
    ({ issues } = await repo.list());
    expect(issues[0].fields).toEqual({});
  });

  it("persists backlog rank for ordering", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const a = await repo.create({ title: "First", creator: ME, rank: 1 });
    const b = await repo.create({ title: "Second", creator: ME, rank: 2 });
    await repo.update(b, { rank: 0.5 }); // fractional re-rank above a
    const { issues } = await repo.list();
    const ranked = issues.sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0)).map((i) => i.url);
    expect(ranked).toEqual([b, a]);
  });

  it("returns an empty list when the container does not exist yet", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const { issues, canCreate } = await repo.list();
    expect(issues).toEqual([]);
    expect(canCreate).toBe(true);
  });
});
