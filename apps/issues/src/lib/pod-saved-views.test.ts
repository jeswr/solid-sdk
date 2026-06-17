// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import { serializePayload, parsePayload, toPodSavedView, PodSavedViews } from "./pod-saved-views";
import { DEFAULT_QUERY, type IssueQuery } from "./filter";
import { Repository } from "./repository";
import { fakePod } from "./testing/fake-pod";

const POD = "http://localhost:3000/alice/";
const TRACKER = `${POD}issue-tracker/tracker.ttl`;
const ME = `${POD}profile/card#me`;

const QUERY: IssueQuery = {
  text: "status:done p:high",
  state: "all",
  priorities: ["high", "low"],
  labels: ["bug", "ui"],
  components: ["api", "ui"],
  versions: ["v1", "v2"],
  assignees: [ME],
  sort: "due",
  sortDir: "asc",
};

describe("pod-saved-views codec", () => {
  it("round-trips a query + layout through the payload", () => {
    const payload = serializePayload(QUERY, "board");
    const parsed = parsePayload(payload);
    expect(parsed.query).toEqual(QUERY);
    expect(parsed.view).toBe("board");
  });

  it("round-trips a query with no layout", () => {
    const parsed = parsePayload(serializePayload(QUERY));
    expect(parsed.query).toEqual(QUERY);
    expect(parsed.view).toBeUndefined();
  });

  it("falls back to safe defaults for a corrupt payload", () => {
    const parsed = parsePayload("{not valid json");
    expect(parsed.query).toEqual(DEFAULT_QUERY);
    expect(parsed.view).toBeUndefined();
  });

  it("clamps out-of-range / hostile fields to defaults", () => {
    const parsed = parsePayload(
      JSON.stringify({
        text: 123, // wrong type → default ""
        state: "deleted-everything", // not a StateFilter → default
        priorities: ["high", "urgent", 7], // keeps only valid priorities
        labels: ["ok", "", "ok"], // drops empty + dedupes
        components: "not-an-array", // → []
        versions: [42, "v1"], // keeps only the string
        assignees: "not-an-array", // → []
        sort: "evil", // → default
        sortDir: "sideways", // → default
        view: "rm-rf", // unknown view → undefined
      }),
    );
    expect(parsed.query.text).toBe(DEFAULT_QUERY.text);
    expect(parsed.query.state).toBe(DEFAULT_QUERY.state);
    expect(parsed.query.priorities).toEqual(["high"]);
    expect(parsed.query.labels).toEqual(["ok"]);
    expect(parsed.query.components).toEqual([]);
    expect(parsed.query.versions).toEqual(["v1"]);
    expect(parsed.query.assignees).toEqual([]);
    expect(parsed.query.sort).toBe(DEFAULT_QUERY.sort);
    expect(parsed.query.sortDir).toBe(DEFAULT_QUERY.sortDir);
    expect(parsed.view).toBeUndefined();
  });

  it("maps a SavedViewDef into a render-friendly view", () => {
    const view = toPodSavedView({ iri: `${TRACKER}#view-x`, name: "X", payload: serializePayload(QUERY, "list") });
    expect(view).toEqual({ iri: `${TRACKER}#view-x`, name: "X", query: QUERY, view: "list" });
  });
});

describe("PodSavedViews store (pod-persisted, shareable)", () => {
  it("saves a view to the tracker config and lists it back", async () => {
    const { impl, store } = fakePod();
    const repo = new Repository(TRACKER, impl);
    const podViews = new PodSavedViews(repo);

    await podViews.save("My high-priority", QUERY, "board");
    const list = await podViews.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("My high-priority");
    expect(list[0].query).toEqual(QUERY);
    expect(list[0].view).toBe("board");
    // It is persisted in the SHARED tracker config doc (not localStorage).
    expect(store.get(TRACKER)).toContain("savedView");
  });

  it("overwrites a view with the same name in place (no duplicate)", async () => {
    const repo = new Repository(TRACKER, fakePod().impl);
    const podViews = new PodSavedViews(repo);

    const first = await podViews.save("Bugs", { ...DEFAULT_QUERY, labels: ["bug"] });
    const second = await podViews.save("Bugs", { ...DEFAULT_QUERY, labels: ["bug", "ui"] });
    expect(second.iri).toBe(first.iri); // same node reused

    const list = await podViews.list();
    expect(list).toHaveLength(1);
    expect(list[0].query.labels).toEqual(["bug", "ui"]);
  });

  it("removes a view by IRI", async () => {
    const repo = new Repository(TRACKER, fakePod().impl);
    const podViews = new PodSavedViews(repo);

    const a = await podViews.save("A", DEFAULT_QUERY);
    await podViews.save("B", DEFAULT_QUERY);
    await podViews.remove(a.iri);

    const list = await podViews.list();
    expect(list.map((v) => v.name)).toEqual(["B"]);
  });

  it("is visible to a second client opening the same tracker (shareable)", async () => {
    const { impl } = fakePod();
    await new PodSavedViews(new Repository(TRACKER, impl)).save("Shared", QUERY, "timeline");

    // A different Repository instance (e.g. a collaborator) reads the same views.
    const otherList = await new PodSavedViews(new Repository(TRACKER, impl)).list();
    expect(otherList.map((v) => v.name)).toEqual(["Shared"]);
    expect(otherList[0].view).toBe("timeline");
  });
});
