// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import {
  planDrop,
  planMove,
  planNest,
  planPromote,
  planToSection,
} from "../../src/apps/tasks/lib/dnd/plan";
import type { DropPlan } from "../../src/apps/tasks/lib/dnd/types";
import type { StoredProject, StoredTask } from "../../src/apps/tasks/lib/model/store";
import { announceRetries, applyDropPlan, replanner } from "../../src/apps/tasks/state/drop-actions";
import type { TasksCache } from "../../src/apps/tasks/state/tasks-cache";
import { frameCache } from "./tasks-frame-fixtures";

vi.mock("@jeswr/suite-ui", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

const writer = (cache: TasksCache) => ({
  cache,
  updateTask: cache.updateTask.bind(cache),
  moveTaskToProject: cache.moveTaskToProject.bind(cache),
});
const viewOf = (cache: TasksCache, title: string) => {
  const found = cache.getSnapshot().views.find((task) => task.title === title);
  if (!found) throw new Error(`Missing ${title}`);
  return found;
};
const projectOf = (cache: TasksCache, url: string) =>
  cache.getSnapshot().projects.find((project) => project.url === url) as StoredProject;
const order = (cache: TasksCache) =>
  cache
    .getSnapshot()
    .views.toSorted((x, y) => (x.position ?? 0) - (y.position ?? 0))
    .map((task) => task.title);
/** Siblings a, b (1e-9 apart: a drop between them renumbers) and c. */
async function cramped() {
  const result = await frameCache();
  for (const [title, rank] of [
    ["a", 0.5],
    ["b", 0.5 + 1e-9],
    ["c", 3],
  ] as const)
    await result.store.createTask(result.inbox, { title, state: "open", rank });
  await result.cache.loadTasks(result.inbox, true);
  const target = {
    kind: "task",
    url: viewOf(result.cache, "a").url,
    container: { kind: "section", projectUrl: result.inbox.url },
    placement: "after",
  } as const;
  const replan = replanner(result.cache, viewOf(result.cache, "c").url, (task, project) =>
    planDrop(task, target, project),
  );
  return { ...result, replan };
}
const storedOrder = async (
  store: Awaited<ReturnType<typeof frameCache>>["store"],
  urls: string[],
) => {
  const ranked = await Promise.all(
    urls.map(async (url) => {
      const { task } = await store.readTask(url);
      return { title: task.title, rank: task.rank ?? 0 };
    }),
  );
  return ranked.toSorted((x, y) => x.rank - y.rank).map((task) => task.title);
};

describe("applyDropPlan", () => {
  it("writes renumber patches before the moved row, every write conditional", async () => {
    const { cache, store, pod, inbox } = await frameCache();
    for (const [title, rank] of [
      ["a", 1],
      ["b", 1 + 1e-9],
      ["c", 2],
    ] as const)
      await store.createTask(inbox, { title, state: "open", rank });
    await cache.loadTasks(inbox, true);
    const views = cache.getSnapshot().views;
    const plan = planDrop(
      viewOf(cache, "c"),
      {
        kind: "task",
        url: viewOf(cache, "a").url,
        container: { kind: "section", projectUrl: inbox.url },
        placement: "after",
      },
      views,
    );
    pod.requests.length = 0;
    expect(await applyDropPlan(plan, writer(cache))).toBe(true);
    const puts = pod.mutations();
    // a already holds rank 1; b is renumbered, then the moved row is written.
    expect(puts.map((request) => request.url)).toEqual(
      ["b", "c"].map((title) => viewOf(cache, title).url),
    );
    expect(puts.every((request) => request.headers.has("If-Match"))).toBe(true);
    for (const [title, rank] of [
      ["a", 1],
      ["b", 2],
      ["c", 1.5],
    ] as const)
      expect((await store.readTask(viewOf(cache, title).url)).task.rank).toBe(rank);
    expect(
      cache
        .getSnapshot()
        .views.sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
        .map((task) => task.title),
    ).toEqual(["a", "c", "b"]);
  });

  it("shows the whole renumbered order at once, as one pending mutation", async () => {
    const { cache, pod, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    pod.intercept = async (request) => {
      if (request.method === "PUT") await gate;
      return undefined;
    };
    const applying = applyDropPlan(replan(), writer(cache), replan);
    // Nothing has been written, yet the moved row and its siblings are already in place.
    expect(order(cache)).toEqual(["a", "c", "b"]);
    expect([...cache.getSnapshot().saving].sort()).toEqual([...urls].sort());
    release();
    expect(await applying).toBe(true);
    pod.intercept = undefined;
    expect(order(cache)).toEqual(["a", "c", "b"]);
  });

  it("writes rising ranks from the end, so a first failure writes nothing", async () => {
    const { cache, pod, store, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === urls[1]
        ? new Response(null, { status: 412 })
        : undefined;
    pod.requests.length = 0;
    expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(false);
    // Not "a saved as 1, then b fails": b (→ 2) goes first, and its failure ends the drop.
    expect(pod.mutations().map((request) => request.url)).toEqual([urls[1]]);
    expect(await storedOrder(store, urls)).toEqual(["a", "b", "c"]);
  });

  it("reverts confirmed sibling writes when one fails midway, and Retry re-plans the drop", async () => {
    const { cache, pod, store, failures, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    const [a, b] = urls;
    let rejected = false;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === a && !rejected) {
        rejected = true;
        return new Response(null, { status: 412 });
      }
    };
    pod.requests.length = 0;
    expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(false);
    // b was saved as 2, a failed: b is restored, over its own revision only.
    expect(pod.mutations().map((request) => request.url)).toEqual([b, a, b]);
    expect(pod.mutations()[2]?.headers.has("If-Match")).toBe(true);
    expect(await storedOrder(store, urls)).toEqual(["a", "b", "c"]);
    expect((await store.readTask(b as string)).task.rank).toBe(0.5 + 1e-9);
    expect(order(cache)).toEqual(["a", "b", "c"]);
    expect(failures).toHaveBeenCalledOnce();
    // Retry plans the whole drop again (renumber included) rather than one sibling's rank.
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect(await storedOrder(store, urls)).toEqual(["a", "c", "b"]);
    expect(order(cache)).toEqual(["a", "c", "b"]);
    expect(failures).toHaveBeenCalledOnce();
  });

  it("counts a lost response whose write landed, and keeps going", async () => {
    const { cache, pod, store, failures, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    let lost = false;
    pod.intercept = async (request) => {
      if (request.method === "PUT" && request.url === urls[0] && !lost) {
        lost = true;
        pod.seed(request.url, request.body);
        throw new TypeError("Response lost");
      }
    };
    expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(true);
    expect(failures).not.toHaveBeenCalled();
    expect(await storedOrder(store, urls)).toEqual(["a", "c", "b"]);
  });

  it("surfaces a lost response that did not land; a failed revert still leaves the order", async () => {
    const { cache, pod, store, failures, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    const [a, b] = urls;
    let wrote = false;
    pod.intercept = (request) => {
      if (request.method === "PUT" && request.url === b) {
        if (wrote) return new Response(null, { status: 503 });
        wrote = true;
      }
      if (request.method === "PUT" && request.url === a) throw new TypeError("Disconnected");
    };
    expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(false);
    expect(failures).toHaveBeenCalledOnce();
    const [failure, retry] = failures.mock.calls[0] as [{ code?: string }, () => void];
    expect(failure.code).toBe("network");
    // b keeps rank 2 (its revert failed), yet the stored order is still a, b, c.
    expect((await store.readTask(b as string)).task.rank).toBe(2);
    expect(await storedOrder(store, urls)).toEqual(["a", "b", "c"]);
    pod.intercept = undefined;
    retry();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect(order(cache)).toEqual(["a", "c", "b"]);
  });

  it("stops reverting at the first failed revert, so the pod keeps a prefix", async () => {
    const result = await frameCache();
    const { cache, pod, store, inbox } = result;
    for (const [title, rank] of [
      ["t0", 5],
      ["t1", 5 + 1e-9],
      ["t2", 6],
    ] as const)
      await store.createTask(inbox, { title, state: "open", rank });
    await cache.loadTasks(inbox, true);
    const items = ["t0", "t1", "t2"].map(
      (title) =>
        cache
          .getSnapshot()
          .tasks[inbox.url]?.items.find((item) => item.task.title === title) as StoredTask,
    );
    const urls = items.map((item) => item.url);
    let reverting = false;
    pod.intercept = (request) => {
      if (request.method !== "PUT") return undefined;
      if (request.url === urls[2]) {
        reverting = true;
        return new Response(null, { status: 412 });
      }
      if (reverting && request.url === urls[1]) return new Response(null, { status: 503 });
    };
    pod.requests.length = 0;
    // Falling ranks, written ascending (renumberWriteOrder): t0 → 1, t1 → 2, t2 → 3.
    const edits = items.map((item, at) => ({
      item,
      change: (task: { rank: number | undefined }) => {
        task.rank = at + 1;
      },
    }));
    expect(await cache.updateTasks(edits, () => {})).toBeUndefined();
    // t1's revert failed, so t0's is never attempted: t0=1, t1=2, t2=6 keeps the order.
    expect(pod.mutations().map((request) => request.url)).toEqual([
      urls[0],
      urls[1],
      urls[2],
      urls[1],
    ]);
    expect(await storedOrder(store, urls)).toEqual(["t0", "t1", "t2"]);
    expect((await store.readTask(urls[0] as string)).task.rank).toBe(1);
  });

  it("leaves the forward prefix when the moved row's outcome cannot be read back", async () => {
    for (const landed of [false, true]) {
      const { cache, pod, store, failures, replan } = await cramped();
      const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
      let offline = false;
      pod.intercept = (request) => {
        if (offline) throw new TypeError("Offline");
        if (request.method === "PUT" && request.url === urls[2]) {
          if (landed) pod.seed(request.url, request.body);
          offline = true;
          throw new TypeError("Response lost");
        }
      };
      pod.requests.length = 0;
      expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(false);
      pod.intercept = undefined;
      expect(failures).toHaveBeenCalledOnce();
      // No revert: b and a keep their new ranks, whichever way the moved row went.
      expect(pod.mutations().map((request) => request.url)).toEqual([urls[1], urls[0], urls[2]]);
      expect(await storedOrder(store, urls)).toEqual(landed ? ["a", "c", "b"] : ["a", "b", "c"]);
      // The failure refresh ran offline; back online the listing revalidates, then Retry.
      await cache.loadTasks(projectOf(cache, viewOf(cache, "a").projectUrl), true);
      const [, retry] = failures.mock.calls[0] as [unknown, () => void];
      retry();
      await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
      expect(await storedOrder(store, urls)).toEqual(["a", "c", "b"]);
    }
  });

  it("never claims, or reverts over, another writer's revision found after a lost response", async () => {
    const { cache, pod, store, failures, replan } = await cramped();
    const urls = ["a", "b", "c"].map((title) => viewOf(cache, title).url);
    pod.intercept = (request) => {
      if (request.method !== "PUT") return undefined;
      if (request.url === urls[0]) {
        // Another client saves a revision that also holds rank 1, then our response is lost.
        pod.seed(request.url, request.body.replace('"a"', '"a (edited)"'));
        throw new TypeError("Response lost");
      }
      if (request.url === urls[2]) return new Response(null, { status: 412 });
    };
    pod.requests.length = 0;
    expect(await applyDropPlan(replan(), writer(cache), replan)).toBe(false);
    pod.intercept = undefined;
    expect(failures).toHaveBeenCalledOnce();
    // Not ours, so the outcome is unknown: no further writes and no revert.
    expect(pod.mutations().map((request) => request.url)).toEqual([urls[1], urls[0]]);
    expect((await store.readTask(urls[0] as string)).task.title).toBe("a (edited)");
    expect((await store.readTask(urls[1] as string)).task.rank).toBe(2);
  });

  it("announces a retry's own outcome, repeating success only where the task now sits", async () => {
    const { cache, replan } = await cramped();
    const task = viewOf(cache, "c");
    const announce = vi.fn();
    const announcer = (plan: DropPlan) =>
      announceRetries(cache, {
        task,
        plan,
        message: "Original",
        showCompleted: false,
        describe: () => "Retried",
        announce,
      });
    // c sits third in No section; a plan that put it there has nothing left to do.
    const here: DropPlan = {
      kind: "position",
      url: task.url,
      projectUrl: task.projectUrl,
      sectionId: undefined,
      parentId: undefined,
      sectionChanged: false,
      parentChanged: false,
      position: 3,
      renumber: [],
      index: 3,
    };
    announcer(here)(true, { kind: "none" });
    announcer(here)(false, { kind: "none" });
    // The first plan put c second (after a): a none re-plan there is a failure.
    announcer(replan())(false, { kind: "none" });
    announcer(here)(false, { kind: "reschedule", url: task.url, dayKey: "2026-11-04" });
    expect(announce.mock.calls.map(([message]) => message)).toEqual([
      "Retried",
      "Original",
      "Couldn't move 'c'.",
      "Couldn't move 'c'.",
    ]);
  });

  it("announces a project move once the cache's own Retry succeeds", async () => {
    const { cache, pod, failures } = await cramped();
    const home = (await cache.createProject("Home")) as StoredProject;
    await cache.loadTasks(home);
    const other = (await cache.createProject("Other")) as StoredProject;
    await cache.loadTasks(other);
    const [a, b] = ["a", "b"].map((title) => viewOf(cache, title));
    pod.intercept = (request) =>
      request.method === "DELETE" ? new Response(null, { status: 503 }) : undefined;
    const onRetried = vi.fn();
    const plan = { kind: "project", url: a?.url as string, projectUrl: home.url } as const;
    expect(await applyDropPlan(plan, writer(cache), undefined, onRetried)).toBe(false);
    const toOther = { kind: "project", url: b?.url as string, projectUrl: home.url } as const;
    expect(await applyDropPlan(toOther, writer(cache), undefined, onRetried)).toBe(false);
    pod.intercept = undefined;
    // b then moves elsewhere (Other) through the menu: no announcement for the Home drop.
    const storedB = cache
      .getSnapshot()
      .tasks[a?.projectUrl as string]?.items.find((item) => item.url === b?.url) as StoredTask;
    await cache.moveTaskToProject(storedB, other);
    expect(onRetried).not.toHaveBeenCalled();
    const [, retry] = failures.mock.calls[0] as [unknown, () => void];
    retry();
    await vi.waitFor(() => expect(onRetried).toHaveBeenCalledWith(true, plan));
    expect(onRetried).toHaveBeenCalledOnce();
  });

  it("re-plans nothing for a vanished task, and skips drops of tasks outside the cache", async () => {
    const { cache } = await cramped();
    expect(replanner(cache, "https://pod.test/missing.ttl", () => ({ kind: "none" }))()).toEqual({
      kind: "none",
    });
    expect(await cache.updateTasks([], () => {})).toBeUndefined();
  });

  it("changes the section class, moves back to No section, and reorders with Move up", async () => {
    const { cache, store, inbox } = await frameCache();
    await cache.addSection(inbox, "Doing");
    const project = projectOf(cache, inbox.url);
    const doing = project.tracker.sections[0]?.id as string;
    await cache.createTask(project, { title: "Pay rent" });
    await cache.createTask(project, { title: "Water plants" });
    const rent = viewOf(cache, "Pay rent");
    expect(
      await applyDropPlan(planToSection(rent, doing, cache.getSnapshot().views), writer(cache)),
    ).toBe(true);
    expect((await store.readTask(rent.url)).task.types.has(doing)).toBe(true);
    expect(viewOf(cache, "Pay rent").sectionId).toBe(doing);
    expect(
      await applyDropPlan(
        planToSection(viewOf(cache, "Pay rent"), undefined, cache.getSnapshot().views),
        writer(cache),
      ),
    ).toBe(true);
    expect((await store.readTask(rent.url)).task.types.has(doing)).toBe(false);
    // Back at the end of No section; Move up puts it first again.
    const views = cache.getSnapshot().views;
    expect(views.find((task) => task.url === rent.url)?.position).toBeGreaterThan(
      views.find((task) => task.title === "Water plants")?.position ?? Infinity,
    );
    expect(await applyDropPlan(planMove(viewOf(cache, "Pay rent"), -1, views), writer(cache))).toBe(
      true,
    );
    expect(viewOf(cache, "Pay rent").position).toBeLessThan(
      viewOf(cache, "Water plants").position ?? -Infinity,
    );
  });

  it("makes a sub-task (dct:isPartOf) and promotes it again", async () => {
    const { cache, store, inbox } = await frameCache();
    await cache.createTask(inbox, { title: "Garden" });
    await cache.createTask(inbox, { title: "Buy soil" });
    const parent = viewOf(cache, "Garden");
    expect(
      await applyDropPlan(
        planNest(viewOf(cache, "Buy soil"), parent, cache.getSnapshot().views),
        writer(cache),
      ),
    ).toBe(true);
    const child = viewOf(cache, "Buy soil");
    expect((await store.readTask(child.url)).task.parent).toBe(parent.id);
    expect(await applyDropPlan(planPromote(child, cache.getSnapshot().views), writer(cache))).toBe(
      true,
    );
    expect((await store.readTask(child.url)).task.parent).toBeUndefined();
  });

  it("reschedules a dropped row keeping its time, or its all-day marker", async () => {
    const { cache, store, inbox } = await frameCache();
    await cache.createTask(inbox, { title: "Timed", due: new Date("2026-11-02T17:00:00Z") });
    await cache.createTask(inbox, {
      title: "All day",
      due: new Date("2026-11-02T00:00:00Z"),
      allDay: "2026-11-02",
    });
    const views = cache.getSnapshot().views;
    for (const title of ["Timed", "All day"])
      expect(
        await applyDropPlan(
          planDrop(viewOf(cache, title), { kind: "day", dayKey: "2026-11-04" }, views),
          writer(cache),
        ),
      ).toBe(true);
    expect((await store.readTask(viewOf(cache, "Timed").url)).task.dueDate?.toISOString()).toBe(
      "2026-11-04T17:00:00.000Z",
    );
    const allDay = (await store.readTask(viewOf(cache, "All day").url)).task;
    expect(allDay.allDay).toBe("2026-11-04");
  });

  it("moves a row dropped on a sidebar project into that project", async () => {
    const { cache, store, inbox } = await frameCache();
    const home = (await cache.createProject("Home")) as StoredProject;
    await cache.loadTasks(home);
    await cache.createTask(inbox, { title: "Move me" });
    const view = viewOf(cache, "Move me");
    expect(
      await applyDropPlan(
        planDrop(view, { kind: "project", projectUrl: home.url }, cache.getSnapshot().views),
        writer(cache),
      ),
    ).toBe(true);
    const moved = viewOf(cache, "Move me");
    expect(moved.projectUrl).toBe(home.url);
    expect(await store.listTasks(inbox.tracker.stateStore as string)).toHaveLength(0);
    expect(await store.listTasks(home.tracker.stateStore as string)).toHaveLength(1);
  });

  it("reports nothing written for no-ops, vanished rows and failed writes", async () => {
    const { cache, pod, inbox } = await frameCache();
    expect(await applyDropPlan({ kind: "none" }, writer(cache))).toBe(false);
    expect(
      await applyDropPlan(
        { kind: "reschedule", url: "missing", dayKey: "2026-11-04" },
        writer(cache),
      ),
    ).toBe(false);
    await cache.createTask(inbox, { title: "a", position: 1 });
    await cache.createTask(inbox, { title: "b", position: 1 + 1e-9 });
    await cache.createTask(inbox, { title: "c", position: 2 });
    const a = viewOf(cache, "a");
    expect(
      await applyDropPlan(
        { kind: "project", url: a.url, projectUrl: "https://pod.test/missing.ttl" },
        writer(cache),
      ),
    ).toBe(false);
    const plan = planDrop(
      viewOf(cache, "c"),
      {
        kind: "task",
        url: a.url,
        container: { kind: "section", projectUrl: inbox.url },
        placement: "after",
      },
      cache.getSnapshot().views,
    );
    if (plan.kind !== "position") throw new Error("Expected a renumbering plan");
    pod.intercept = (request) =>
      request.method === "PUT" && request.url === viewOf(cache, "b").url
        ? new Response(null, { status: 500 })
        : undefined;
    expect(await applyDropPlan(plan, writer(cache))).toBe(false);
    pod.intercept = undefined;
    // The moved row keeps its old position when a renumber write fails.
    expect(viewOf(cache, "c").position).toBe(2);
    expect(
      await applyDropPlan({ ...plan, renumber: [{ url: "missing", position: 1 }] }, writer(cache)),
    ).toBe(false);
  });
});
