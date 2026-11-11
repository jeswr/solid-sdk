// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { DataFactory, Node, NS, node, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { savedFilters } from "../../src/apps/tasks/lib/views/filter-query";
import { frameCache, frameStore } from "./tasks-frame-fixtures";
import { project } from "./tasks-views-fixtures";

describe("tracker saved views", () => {
  it("links local fragments, round-trips, renames with a stable IRI and removes", async () => {
    const { cache, pod, inbox } = await frameCache();
    const first = await cache.saveFilter("Bills", { v: 1, labels: ["bills"] });
    expect(first?.iri).toBe(`${inbox.url}#view-bills`);
    const rdf = await pod.dataset(inbox.url);
    expect([...node(inbox.tracker.id, rdf).iris(`${NS.WF}savedView`)]).toEqual([first?.iri]);
    expect(node(first?.iri as string, rdf).text(`${NS.DCT}title`)).toBe("Bills");
    expect(node(first?.iri as string, rdf).text(`${NS.WF}viewQuery`)).toBe(
      '{"v":1,"labels":["bills"]}',
    );
    const writes = pod
      .mutations()
      .filter((request) => request.url === inbox.url && request.method === "PUT");
    expect(writes.at(-1)?.headers.get("If-Match")).toBe(inbox.etag);
    expect((await frameStore(pod).readProject(inbox.url)).tracker.savedViews).toEqual([first]);
    const renamed = await cache.saveFilter("Urgent", { v: 1, priorities: [1] }, first?.iri);
    expect(renamed?.iri).toBe(first?.iri);
    const duplicate = await cache.saveFilter("Urgent", { v: 1 });
    expect(duplicate?.iri).toBe(`${inbox.url}#view-urgent`);
    const another = await cache.saveFilter("Urgent", { v: 1 });
    expect(another?.iri).toBe(`${inbox.url}#view-urgent-2`);
    const beforeRemove = (await cache.store.readProject(inbox.url)).etag;
    await cache.removeFilter(first?.iri as string);
    expect(pod.mutations().at(-1)?.headers.get("If-Match")).toBe(beforeRemove);
    expect((await cache.store.readProject(inbox.url)).tracker.savedViews).toHaveLength(2);
    expect(
      (await pod.dataset(inbox.url)).match(DataFactory.namedNode(first?.iri as string)).size,
    ).toBe(0);
  });
  it("skips hostile, partial and invalid definitions and only unlinks hostile targets", async () => {
    const { tracker, dataset, url } = project();
    for (const term of [DataFactory.blankNode(), DataFactory.literal("hostile")])
      node(tracker.id, dataset)
        .nodes(`${NS.WF}savedView`)
        .add(new Node(term, dataset, DataFactory));
    const hostiles = [
      tracker.id,
      `${url}#Label`,
      `${url}#view-`,
      `${url}#view-bad/path`,
      "https://foreign.test/t.ttl#view-evil",
      `${url}x#view-evil`,
    ];
    for (const iri of hostiles) {
      node(tracker.id, dataset).iris(`${NS.WF}savedView`).add(iri);
      node(iri, dataset).setText(`${NS.DCT}title`, "Keep");
      node(iri, dataset).setText(`${NS.WF}viewQuery`, '{"v":1}');
    }
    node(tracker.id, dataset).iris(`${NS.WF}savedView`).add(`${url}#view-partial`);
    const missingName = tracker.defineSavedView("Missing name", '{"v":1}');
    node(missingName.iri, dataset).clear(`${NS.DCT}title`);
    const blankName = tracker.defineSavedView("Blank", '{"v":1}');
    node(blankName.iri, dataset).setText(`${NS.DCT}title`, "  ");
    tracker.defineSavedView("Old version", '{"v":2}');
    const safe = tracker.defineSavedView("Safe", '{"v":1}', tracker.id);
    expect(safe.iri).toBe(`${url}#view-safe`);
    expect(savedFilters(tracker.savedViews)).toEqual([
      { iri: safe.iri, name: "Safe", query: { v: 1 } },
    ]);
    for (const iri of hostiles) {
      const before = [...dataset.match(DataFactory.namedNode(iri))];
      tracker.removeSavedView(iri);
      // The tracker itself loses only the savedView link, retaining all configuration.
      expect(node(iri, dataset).text(`${NS.DCT}title`)).toBe("Keep");
      if (iri !== tracker.id)
        expect([...dataset.match(DataFactory.namedNode(iri))]).toEqual(before);
    }
    expect(() => tracker.defineSavedView(" ", "{}")).toThrow();
  });
  it.each([
    403, 412, 500,
  ])("rolls back failed %s writes and retries using a fresh ETag", async (status) => {
    const { cache, pod, inbox, failures } = await frameCache();
    pod.intercept = (request) =>
      request.url === inbox.url && request.method === "PUT"
        ? new Response(null, { status })
        : undefined;
    expect(await cache.saveFilter("Retry", { v: 1 })).toBeUndefined();
    expect(cache.getSnapshot().projects[0]?.tracker.savedViews).toEqual([]);
    expect(failures).toHaveBeenCalledOnce();
    pod.intercept = undefined;
    const remote = await cache.store.readProject(inbox.url);
    remote.tracker.description = "Remote metadata";
    pod.seed(inbox.url, await serialize(remote.dataset));
    failures.mock.calls[0]?.[1]();
    await new Promise<void>((resolve) => {
      const unsubscribe = cache.subscribe(() => {
        if (!cache.getSnapshot().saving.length) {
          unsubscribe();
          resolve();
        }
      });
    });
    const fresh = await cache.store.readProject(inbox.url);
    expect(fresh.tracker.description).toBe("Remote metadata");
    expect(fresh.tracker.savedViews[0]?.name).toBe("Retry");
  });
  it("queues creates with distinct IDs and preserves unrelated tracker data", async () => {
    const { cache, inbox } = await frameCache();
    const first = cache.saveFilter("Same", { v: 1 });
    const second = cache.saveFilter("Same", { v: 1 });
    expect(cache.getSnapshot().projects[0]?.tracker.savedViews).toHaveLength(2);
    expect(cache.getSnapshot().saving).toEqual([inbox.url, inbox.url]);
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result?.iri)).toEqual([
      `${inbox.url}#view-same`,
      `${inbox.url}#view-same-2`,
    ]);
    expect((await cache.store.readProject(inbox.url)).tracker.title).toBe("Inbox");
  });
});
