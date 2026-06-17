import { describe, it, expect } from "vitest";
import { Store, Parser } from "n3";
import { parseTask, isAssignedTo } from "@jeswr/solid-task-model/task";
import { Repository } from "./repository";
import { TransitionError } from "./errors";
import { type WorkflowDef } from "./issue";
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

  it("round-trips components through create, update, list, and info (declared on use)", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);

    // Components are declared by display name on first use, exactly like labels.
    const url = await repo.create({ title: "C", creator: ME, components: ["API", "UI"] });
    let { issues } = await repo.list();
    expect(issues[0].components.sort()).toEqual(["api", "ui"]);
    // info() surfaces the tracker-level component definitions.
    expect((await repo.info()).components.map((c) => c.label)).toEqual(["API", "UI"]);

    // Updating replaces the set; an empty array clears it.
    await repo.update(url, { components: ["API"] });
    ({ issues } = await repo.list());
    expect(issues[0].components).toEqual(["api"]);
    await repo.update(url, { components: [] });
    ({ issues } = await repo.list());
    expect(issues[0].components).toEqual([]);

    // Reusing a known display name does not duplicate the definition.
    await repo.create({ title: "C2", creator: ME, components: ["api"] });
    expect((await repo.info()).components.map((c) => c.slug)).toEqual(["api", "ui"]);
  });

  it("round-trips affects/fix versions through create, update, list, and info", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);

    const url = await repo.create({ title: "V", creator: ME, affectsVersion: "1.0", fixVersion: "2.0" });
    let { issues } = await repo.list();
    expect(issues[0].affectsVersion).toBe("1-0");
    expect(issues[0].fixVersion).toBe("2-0");
    // Both versions were declared on the tracker, ordered by schema:position.
    expect((await repo.info()).versions.map((v) => v.label)).toEqual(["1.0", "2.0"]);

    // Reassign the fix-version; clear the affects-version explicitly.
    await repo.update(url, { fixVersion: "1.0", affectsVersion: undefined });
    ({ issues } = await repo.list());
    expect(issues[0].fixVersion).toBe("1-0");
    expect(issues[0].affectsVersion).toBeUndefined();
    // No new version definition was minted (1.0 already existed).
    expect((await repo.info()).versions.map((v) => v.slug)).toEqual(["1-0", "2-0"]);
  });

  it("manages tracker-level version metadata (position, release date, released flag)", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.ensureTracker();
    const date = new Date("2026-07-01T00:00:00.000Z");
    await repo.defineVersion("2.0", { position: 2 });
    await repo.defineVersion("1.0", { position: 1, releaseDate: date, released: true });

    const versions = await repo.versions();
    expect(versions.map((v) => v.label)).toEqual(["1.0", "2.0"]); // schema:position order
    const v1 = versions.find((v) => v.slug === "1-0")!;
    expect(v1.releaseDate!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(v1.released).toBe(true);

    await repo.removeVersion("2-0");
    expect((await repo.versions()).map((v) => v.slug)).toEqual(["1-0"]);
  });

  it("re-declaring a version by its SLUG does not clobber its label / release metadata", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.ensureTracker();
    const date = new Date("2026-07-01T00:00:00.000Z");
    await repo.defineVersion("1.0", { releaseDate: date, released: true });

    // Simulate the edit form re-submitting the STORED slug ("1-0") rather than
    // the display label ("1.0") — e.g. before the tracker defs loaded. This must
    // resolve to the same version WITHOUT redefining it (which would overwrite
    // the label with "1-0" and clear the date / released flag).
    const slug = await repo.declareVersion("1-0");
    expect(slug).toBe("1-0");
    const versions = await repo.versions();
    expect(versions).toHaveLength(1);
    expect(versions[0].label).toBe("1.0"); // label preserved (not overwritten with the slug)
    expect(versions[0].releaseDate!.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(versions[0].released).toBe(true);
  });

  it("re-declaring a component by its SLUG reuses it (no duplicate definition)", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.defineComponent("Auth Service"); // slug: auth-service

    const slugs = await repo.declareComponents(["auth-service"]); // round-trip the slug
    expect(slugs).toEqual(["auth-service"]);
    const defs = await repo.components();
    expect(defs).toHaveLength(1);
    expect(defs[0].label).toBe("Auth Service"); // label preserved
  });

  it("rejects unsafe URL custom-field values at the data layer", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.ensureTracker();
    await repo.defineField("Doc", "url");

    const url = await repo.create({ title: "X", creator: ME, fields: { doc: "javascript:alert(1)" } });
    let { issues } = await repo.list();
    expect(issues[0].fields).toEqual({}); // never persisted

    await repo.update(url, { fields: { doc: "https://example.org/spec" } });
    await repo.update(url, { fields: { doc: "data:text/html,hi" } }); // overwrite attempt drops the value
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

  it("F2: round-trips typed links through create and update", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const orig = await repo.create({ title: "Original", creator: ME });
    const canon = await repo.create({ title: "Canonical", creator: ME });
    const peer = await repo.create({ title: "Peer", creator: ME });

    const url = await repo.create({
      title: "Linked",
      creator: ME,
      relatesTo: [peer],
      duplicateOf: canon,
      clonedFrom: orig,
    });
    let rec = (await repo.list()).issues.find((i) => i.url === url)!;
    expect(rec.relatesTo).toEqual([peer]);
    expect(rec.duplicateOf).toBe(canon);
    expect(rec.clonedFrom).toBe(orig);

    // Update replaces the relates set and clears the duplicate link.
    await repo.update(url, { relatesTo: [], duplicateOf: undefined });
    rec = (await repo.list()).issues.find((i) => i.url === url)!;
    expect(rec.relatesTo).toEqual([]);
    expect(rec.duplicateOf).toBeUndefined();
    expect(rec.clonedFrom).toBe(orig); // untouched by the patch
  });

  it("federation: an issue CREATED by the repository is found by the shared parseTask", async () => {
    // The linchpin: a task this app creates must be readable as a federated task by
    // the Pod Manager (and any suite app), which parses the shared subject
    // `${url}#it`. Exercise the REAL create path (no hand-constructed subject), then
    // parse the stored bytes through the shared model exactly as a foreign app would.
    const { impl, store } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const ASSIGNEE = `${POD}bob/profile/card#me`;
    const url = await repo.create({
      title: "Federated issue",
      description: "Body authored in solid-issues.",
      creator: ME,
      assignee: ASSIGNEE,
      priority: "high",
    });

    // The created document is stored as Turtle; parse it and read it as a shared task.
    const body = store.get(url)!;
    const dataset = new Store();
    dataset.addQuads(new Parser({ baseIRI: url }).parse(body));

    // The subject is the SHARED canonical `${url}#it`, so parseTask finds it.
    const task = parseTask(url, dataset);
    expect(task).toBeDefined();
    expect(task?.title).toBe("Federated issue");
    expect(task?.description).toBe("Body authored in solid-issues.");
    expect(task?.assignee).toBe(ASSIGNEE); // "assigned to me" in the Pod Manager
    expect(task?.state).toBe("open");
    // Priority is co-written as schema:priority (the PM-read predicate).
    expect(task?.priority).toBe("high");
    // isAssignedTo — the exact federation gate the Pod Manager applies.
    expect(isAssignedTo(task?.assignee, ASSIGNEE)).toBe(true);
  });

  it("F8: a bulk assign + label across a selection applies to every issue in one batch", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const a = await repo.create({ title: "A", creator: ME });
    const b = await repo.create({ title: "B", creator: ME });
    const c = await repo.create({ title: "C", creator: ME });
    const selection = [a, b, c];
    const ASSIGNEE = `${POD}bob/profile/card#me`;

    // The hook's batch boundary is "apply N ops against one Repository, then
    // refresh once" — modelled here as a sequential apply over the selection.
    for (const url of selection) {
      await repo.update(url, { assignee: ASSIGNEE, labels: ["triage"] });
    }

    const { issues } = await repo.list();
    for (const url of selection) {
      const rec = issues.find((i) => i.url === url)!;
      expect(rec.assignee).toBe(ASSIGNEE);
      expect(rec.labels).toEqual(["triage"]);
    }
  });

  it("F8: a bulk state change closes every selected issue", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const urls = await Promise.all([
      repo.create({ title: "A", creator: ME }),
      repo.create({ title: "B", creator: ME }),
    ]);
    for (const url of urls) await repo.setState(url, "closed");
    const { issues } = await repo.list();
    expect(issues.every((i) => i.state === "closed")).toBe(true);
  });

  it("F8: a bulk op surfaces a failure instead of silently swallowing it", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const ok = await repo.create({ title: "Real", creator: ME });
    const missing = `${CONTAINER}does-not-exist.ttl`;

    // Running the batch over [ok, missing] must reject when it reaches the
    // unreadable member — the caller (the hook's `run`) then refreshes/toasts.
    await expect(
      (async () => {
        for (const url of [ok, missing]) await repo.update(url, { assignee: `${POD}bob/profile/card#me` });
      })(),
    ).rejects.toBeTruthy();
  });
});

describe("F1: configurable workflow (repository)", () => {
  const CUSTOM: WorkflowDef = {
    statuses: [
      { slug: "backlog", label: "Backlog", terminal: false },
      { slug: "doing", label: "Doing", terminal: false },
      { slug: "review", label: "In Review", terminal: false },
      { slug: "shipped", label: "Shipped", terminal: true },
    ],
    transitions: { backlog: ["doing"], doing: ["review", "backlog"], review: ["shipped", "doing"], shipped: [] },
  };

  it("persists a custom workflow to the tracker and reads it back", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl);
    await repo.ensureTracker();
    await repo.defineWorkflow(CUSTOM);

    const wfDef = await repo.workflow();
    expect(wfDef.statuses.map((s) => s.slug)).toEqual(["backlog", "doing", "review", "shipped"]);
    expect(wfDef.statuses.find((s) => s.slug === "shipped")?.terminal).toBe(true);
    expect(wfDef.transitions["review"].sort()).toEqual(["doing", "shipped"]);
  });

  it("allows a permitted transition and rejects a disallowed one", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    await repo.ensureTracker();
    await repo.defineWorkflow(CUSTOM);
    // New issues start in the initial state (backlog) by default.
    const url = await repo.create({ title: "Ship it", creator: ME, status: "backlog" });

    // backlog → doing is allowed.
    await repo.setStatus(url, "doing");
    let { issues } = await repo.list();
    expect(issues[0].status).toBe("doing");

    // doing → shipped is NOT in the rules — rejected, status unchanged.
    await expect(repo.setStatus(url, "shipped")).rejects.toBeInstanceOf(TransitionError);
    ({ issues } = await repo.list());
    expect(issues[0].status).toBe("doing");

    // Walk the legal path doing → review → shipped.
    await repo.setStatus(url, "review");
    await repo.setStatus(url, "shipped");
    ({ issues } = await repo.list());
    expect(issues[0].status).toBe("shipped");
    expect(issues[0].state).toBe("closed"); // terminal resolves to closed
  });

  it("create defaults to the workflow's initial state (not the built-in 'todo')", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    await repo.ensureTracker();
    await repo.defineWorkflow(CUSTOM);

    // No status supplied → uses the workflow's first declared status (backlog).
    const url = await repo.create({ title: "Fresh", creator: ME });
    const rec = (await repo.list()).issues.find((i) => i.url === url)!;
    expect(rec.status).toBe("backlog");
    expect(rec.state).toBe("open");
    // It is NOT typed with the built-in #status-todo class.
    expect(rec.status).not.toBe("todo");
  });

  it("create with a terminal status records state=closed via the workflow resolution", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    await repo.ensureTracker();
    await repo.defineWorkflow(CUSTOM);

    // "shipped" is terminal in CUSTOM → the new issue must be closed, not open.
    const url = await repo.create({ title: "Born shipped", creator: ME, status: "shipped" });
    const rec = (await repo.list()).issues.find((i) => i.url === url)!;
    expect(rec.status).toBe("shipped");
    expect(rec.state).toBe("closed");
  });

  it("create rejects a status not declared in the workflow", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    await repo.ensureTracker();
    await repo.defineWorkflow(CUSTOM);

    // "todo" is the built-in default but is NOT a status in CUSTOM.
    await expect(repo.create({ title: "Bad", creator: ME, status: "todo" })).rejects.toBeInstanceOf(TransitionError);
  });
});

describe("F3: provenance activity log (repository)", () => {
  const TRACKER_STATUS = (slug: string) => `${TRACKER}#status-${slug}`;

  it("appends an append-only status-change entry on setStatus", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Track me", creator: ME, status: "todo" });

    await repo.setStatus(url, "in-progress");
    await repo.setStatus(url, "done");

    const log = await repo.activityLog(url);
    // Two status transitions recorded (creation default isn't a transition).
    const statusEntries = log.filter((e) => e.kind === "status");
    expect(statusEntries).toHaveLength(2);
    // Newest first: the done transition leads.
    expect(statusEntries[0].generated).toBe(TRACKER_STATUS("done"));
    expect(statusEntries[0].used).toBe(TRACKER_STATUS("in-progress"));
    expect(statusEntries[1].generated).toBe(TRACKER_STATUS("in-progress"));
    // The actor (the signed-in WebID) is stamped.
    expect(statusEntries[0].actor).toBe(ME);
    expect(statusEntries[0].at).toBeInstanceOf(Date);
  });

  it("records assignment and link changes via update, and is append-only", async () => {
    const { impl, store } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Assign me", creator: ME });
    const canonical = await repo.create({ title: "Canonical", creator: ME });
    const bob = `${POD}bob/profile/card#me`;

    await repo.update(url, { assignee: bob });
    await repo.update(url, { duplicateOf: canonical });

    const log = await repo.activityLog(url);
    expect(log.find((e) => e.kind === "assignment")?.generated).toBe(bob);
    expect(log.find((e) => e.kind === "link")?.generated).toBe(canonical);

    // Append-only: the page document grows (more prov:Activity nodes) but no
    // existing entry's IRI is reused or removed.
    const ids = log.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // all distinct
    // A second update appends without dropping the earlier entries.
    const before = (await repo.activityLog(url)).length;
    await repo.update(url, { assignee: ME });
    const after = await repo.activityLog(url);
    expect(after.length).toBe(before + 1);
    // Every earlier entry id still present.
    for (const id of ids) expect(after.some((e) => e.id === id)).toBe(true);

    // The log lives in the sibling activity/ container (capped per-page growth).
    expect([...store.keys()].some((k) => k.includes("/activity/"))).toBe(true);
  });

  it("does not record a status entry when the status is unchanged", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Idempotent", creator: ME, status: "todo" });
    await repo.setStatus(url, "todo"); // no-op transition
    const log = await repo.activityLog(url);
    expect(log.filter((e) => e.kind === "status")).toHaveLength(0);
  });

  it("statusHistory returns only status transitions as { to, at }, ascending, with slugs", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Replay me", creator: ME, status: "todo" });
    const bob = `${POD}bob/profile/card#me`;

    await repo.setStatus(url, "in-progress");
    await repo.update(url, { assignee: bob }); // assignment, NOT a status entry
    await repo.setStatus(url, "done");

    const history = await repo.statusHistory(url);
    // Only the two status transitions, ascending by time.
    expect(history.map((h) => h.to)).toEqual(["in-progress", "done"]);
    for (const h of history) expect(h.at).toBeInstanceOf(Date);
    expect(history[0].at.getTime()).toBeLessThan(history[1].at.getTime());
  });

  it("statusHistory bounds the pages it reads", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Bounded", creator: ME, status: "todo" });
    await repo.setStatus(url, "in-progress");

    // Count network reads of activity pages; with maxPages=1 only page-0 is read.
    let pageReads = 0;
    const counting: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input).split("#")[0];
      if ((init?.method ?? "GET").toUpperCase() === "GET" && u.includes("/activity/")) pageReads++;
      return impl(input as never, init);
    }) as typeof fetch;

    const bounded = new Repository(TRACKER, counting, ME);
    const history = await bounded.statusHistory(url, 1);
    expect(history.map((h) => h.to)).toEqual(["in-progress"]);
    expect(pageReads).toBe(1); // never walked past page 0
  });

  it("dashboardStatusHistory fans out a bounded read across issues", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const a = await repo.create({ title: "A", creator: ME, status: "todo" });
    const b = await repo.create({ title: "B", creator: ME, status: "todo" });
    await repo.setStatus(a, "in-progress");
    await repo.setStatus(b, "done");

    const map = await repo.dashboardStatusHistory([a, b], 4, 2);
    expect(map.get(a)?.map((h) => h.to)).toEqual(["in-progress"]);
    expect(map.get(b)?.map((h) => h.to)).toEqual(["done"]);
  });

  it("two concurrent appends to a new page both survive (If-None-Match retry)", async () => {
    // Simulate a lost-update race on the FIRST (create-only) write of a fresh log
    // page: a competing writer slips its own entry into the same page document
    // between our read and our write. The create-only PUT (If-None-Match: *) then
    // 412s, and the retry re-reads + appends under If-Match — so neither entry is
    // lost. Without the conditional create, our write would clobber the competitor.
    const { impl, store } = fakePod();
    const url = await new Repository(TRACKER, impl, ME).create({ title: "Race me", creator: ME });

    let injected = false;
    const racing: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input).split("#")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      // On our first create-only PUT to the activity page, let a competing writer
      // win the create first, so our write loses the race and must retry.
      if (
        !injected &&
        method === "PUT" &&
        u.includes("/activity/") &&
        new Headers(init?.headers).get("if-none-match") === "*"
      ) {
        injected = true;
        const rival = new Repository(TRACKER, impl, `${POD}bob/profile/card#me`);
        await rival.appendActivity(url, { kind: "assignment", at: new Date() });
      }
      return impl(input as never, init);
    }) as typeof fetch;

    const repo = new Repository(TRACKER, racing, ME);
    await repo.appendActivity(url, { kind: "status", at: new Date(), generated: TRACKER_STATUS("done") });

    // BOTH entries must be present — the rival's assignment and our status change.
    const log = await new Repository(TRACKER, impl).activityLog(url);
    expect(log.filter((e) => e.kind === "assignment")).toHaveLength(1);
    expect(log.filter((e) => e.kind === "status")).toHaveLength(1);
    // Append-only: distinct IRIs, both stored in the single (page-0) log document.
    expect(new Set(log.map((e) => e.id)).size).toBe(2);
    const activityDocs = [...store.keys()].filter((k) => k.includes("/activity/"));
    expect(activityDocs).toHaveLength(1); // both landed on the same page, not split
    const page = store.get(activityDocs[0])!;
    for (const e of log) expect(page).toContain(e.id);
  });
});

describe("dependency enforcement (#75 P1-4): authoritative openBlockers", () => {
  it("reports an issue's open (not-closed) blockers, read fresh from the pod", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const blocker = await repo.create({ title: "Do me first", creator: ME });
    const blocked = await repo.create({ title: "Needs the other", creator: ME, blockedBy: [blocker] });

    const open = await repo.openBlockers(blocked);
    expect(open.map((b) => b.url)).toEqual([blocker]);
    expect(open[0].title).toBe("Do me first");
  });

  it("clears a blocker once it is CLOSED (a closed blocker no longer obstructs)", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const blocker = await repo.create({ title: "Prereq", creator: ME });
    const blocked = await repo.create({ title: "Dependent", creator: ME, blockedBy: [blocker] });

    expect(await repo.openBlockers(blocked)).toHaveLength(1);
    await repo.setState(blocker, "closed");
    expect(await repo.openBlockers(blocked)).toEqual([]);
  });

  it("returns nothing for an issue with no blockers", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const url = await repo.create({ title: "Standalone", creator: ME });
    expect(await repo.openBlockers(url)).toEqual([]);
  });

  it("fails open: an unreadable / missing blocker is not reported", async () => {
    const { impl } = fakePod();
    const repo = new Repository(TRACKER, impl, ME);
    const blocked = await repo.create({
      title: "Points at nothing",
      creator: ME,
      blockedBy: [`${CONTAINER}does-not-exist.ttl`],
    });
    expect(await repo.openBlockers(blocked)).toEqual([]);
  });
});
