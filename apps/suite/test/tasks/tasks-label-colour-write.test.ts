// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { PROJECT_COLOURS } from "@jeswr/suite-ui/tokens";
import { expect, it, vi } from "vitest";
import { DataFactory, NS, node, SCHEMA } from "../../src/apps/tasks/lib/model/rdf";
import { labelColour } from "../../src/apps/tasks/lib/views/label-colours";
import { setLabelColour } from "../../src/apps/tasks/state/label-colour";
import { frameCache } from "./tasks-frame-fixtures";

const blue = PROJECT_COLOURS[8].hex;
const red = PROJECT_COLOURS[0].hex;

async function fixture() {
  const result = await frameCache();
  const home = await result.cache.createProject("Home");
  if (!home) throw new Error("Missing Home");
  for (const [project, names] of [
    [result.inbox, ["Bills", "bills"]],
    [home, ["BILLS"]],
  ] as const)
    await result.cache.updateProject(project, (tracker) => {
      for (const name of names) tracker.defineCategory("Label", name, undefined, red);
      tracker.defineCategory("Label", "Other", undefined, red);
    });
  return { ...result, home };
}

it("writes every case-insensitive local class with schema:color and each tracker's If-Match, then clears it", async () => {
  const { cache, store, pod } = await fixture();
  const before = cache.getSnapshot().projects;
  const start = pod.mutations().length;
  const result = await setLabelColour("bills", blue.toLowerCase(), { cache });
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(2);
  const writes = pod.mutations().slice(start);
  expect(writes).toHaveLength(2);
  for (const project of before) {
    expect(writes.find((write) => write.url === project.url)?.headers.get("If-Match")).toBe(
      project.etag,
    );
    const stored = await store.readProject(project.url);
    for (const label of stored.tracker.labels.filter(
      (label) => label.name.toLowerCase() === "bills",
    ))
      expect(
        stored.dataset
          .getQuads(
            DataFactory.namedNode(label.id),
            DataFactory.namedNode(`${SCHEMA}color`),
            null,
            null,
          )
          .map((quad) => quad.object.value),
      ).toEqual([blue]);
    expect(stored.tracker.labels.find((label) => label.name === "Other")?.color).toBe(red);
  }
  const count = pod.mutations().length;
  await setLabelColour("BILLS", blue, { cache });
  expect(pod.mutations()).toHaveLength(count);
  const coloured = cache.getSnapshot().projects;
  await setLabelColour("bills", undefined, { cache });
  for (const project of coloured)
    expect(
      pod
        .mutations()
        .slice(count)
        .find((write) => write.url === project.url)
        ?.headers.get("If-Match"),
    ).toBe(project.etag);
  for (const project of before)
    expect(
      (await store.readProject(project.url)).tracker.labels
        .filter((label) => label.name.toLowerCase() === "bills")
        .map((label) => label.color),
    ).toEqual(
      project.tracker.labels
        .filter((label) => label.name.toLowerCase() === "bills")
        .map(() => undefined),
    );
  await expect(setLabelColour("bills", "red", { cache })).rejects.toThrow("Unknown label colour");
});

it("uses the first label in project order, including absent or invalid colours, without changing TaskView", async () => {
  const { cache, inbox, home } = await fixture();
  await cache.updateProject(home, (tracker) =>
    tracker.defineCategory("Label", "BILLS", undefined, blue),
  );
  expect(labelColour("BiLlS", cache.getSnapshot().projects)).toBe(red);
  expect(labelColour("bills", [...cache.getSnapshot().projects].reverse())).toBe(blue);
  for (const color of [
    undefined,
    "unknown",
    `${blue};background:url(https://evil.test)`,
    `${blue.slice(0, -1)}0`,
  ]) {
    await cache.updateProject(inbox, (tracker) =>
      tracker.defineCategory("Label", "Bills", undefined, color),
    );
    expect(labelColour("bills", cache.getSnapshot().projects)).toBeUndefined();
  }
  expect(labelColour("missing", cache.getSnapshot().projects)).toBeUndefined();
});

it("keeps successful projects on partial failure and offers one failure toast that retries only failed trackers", async () => {
  const { cache, inbox, home, store, pod, failures } = await fixture();
  const errorToast = vi.spyOn(toast, "error");
  pod.intercept = (request) =>
    request.method === "PUT" && request.url === home.url
      ? new Response(null, { status: 403 })
      : undefined;
  const result = await setLabelColour("bills", blue, { cache });
  expect(result.done.map(({ project }) => project.url)).toEqual([inbox.url]);
  expect(result.failed.map(({ item }) => item.project.url)).toEqual([home.url]);
  expect(labelColour("bills", [await store.readProject(inbox.url)])).toBe(blue);
  expect(labelColour("bills", [await store.readProject(home.url)])).toBe(red);
  expect(failures).not.toHaveBeenCalled();
  expect(errorToast).toHaveBeenCalledOnce();
  expect(errorToast.mock.calls[0]?.[1]?.description).toContain("Home");
  const start = pod.mutations().length;
  pod.intercept = undefined;
  const retry = errorToast.mock.calls[0]?.[1]?.action;
  if (!retry || typeof retry !== "object" || !("onClick" in retry))
    throw new Error("Missing Retry");
  retry.onClick({} as Parameters<typeof retry.onClick>[0]);
  await vi.waitFor(async () =>
    expect(labelColour("bills", [await store.readProject(home.url)])).toBe(blue),
  );
  expect(
    pod
      .mutations()
      .slice(start)
      .map((write) => write.url),
  ).toEqual([home.url]);
  errorToast.mockRestore();
});

it("retries a conflicting colour change by name after a remote rename creates a replacement label", async () => {
  const { cache, inbox, home, store, pod, failures } = await fixture();
  const cachedHome = cache.getSnapshot().projects.find((project) => project.url === home.url);
  const current = await store.readProject(home.url);
  const original = current.tracker.labels.find((label) => label.name === "BILLS");
  if (!original) throw new Error("Missing Bills");
  const remote = await store.updateProject(current, (tracker) => {
    node(original.id, tracker.dataset).setText(`${NS.RDFS}label`, "History");
    tracker.defineCategory("Label", "BiLlS", undefined, red);
  });
  const replacement = remote.tracker.labels.find((label) => label.name === "BiLlS");
  expect(replacement?.id).not.toBe(original.id);
  const errorToast = vi.spyOn(toast, "error");
  try {
    const start = pod.mutations().length;
    const result = await setLabelColour("bills", blue, { cache });
    expect(result.done.map(({ project }) => project.url)).toEqual([inbox.url]);
    expect(result.failed.map(({ item }) => item.project.url)).toEqual([home.url]);
    expect(
      pod
        .mutations()
        .slice(start)
        .find((write) => write.url === home.url)
        ?.headers.get("If-Match"),
    ).toBe(cachedHome?.etag);
    expect(cachedHome?.etag).not.toBe(remote.etag);
    expect(failures).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledOnce();
    const retry = errorToast.mock.calls[0]?.[1]?.action;
    if (!retry || typeof retry !== "object" || !("onClick" in retry))
      throw new Error("Missing Retry");
    const retryStart = pod.mutations().length;
    retry.onClick({} as Parameters<typeof retry.onClick>[0]);
    await vi.waitFor(async () => {
      const stored = await store.readProject(home.url);
      expect(stored.tracker.labels.find((label) => label.id === replacement?.id)?.color).toBe(blue);
      expect(stored.tracker.labels.find((label) => label.id === original.id)).toMatchObject({
        name: "History",
        color: red,
      });
    });
    const writes = pod.mutations().slice(retryStart);
    expect(writes.map((write) => write.url)).toEqual([home.url]);
    expect(writes[0]?.headers.get("If-Match")).toBe(remote.etag);
  } finally {
    errorToast.mockRestore();
  }
});
