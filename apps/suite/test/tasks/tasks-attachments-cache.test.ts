// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { ModelError } from "../../src/apps/tasks/lib/model/errors";
import { frameCache } from "./tasks-frame-fixtures";

const first = "https://example.org/brief.pdf";
const second = "https://example.org/notes";

describe("attachment edits through the task cache", () => {
  it("adds and removes links optimistically while serialising edits with current validators", async () => {
    const { cache, inbox, store, pod } = await frameCache();
    const item = await cache.createTask(inbox, { title: "Task" });
    if (!item) throw new Error("Missing task");
    const added = cache.updateTask(item, (task) => {
      task.attachments = [...task.attachments, first];
    });
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.attachments).toEqual([first]);
    const next = cache.updateTask(item, (task) => {
      task.attachments = [...task.attachments, second];
    });
    const removed = cache.updateTask(item, (task) => {
      task.attachments = task.attachments.filter((url) => url !== first);
    });
    expect(cache.getSnapshot().tasks[inbox.url]?.items[0]?.task.attachments).toEqual([second]);
    const [a, b] = await Promise.all([added, next, removed]);
    const puts = pod
      .mutations()
      .filter((request) => request.url === item.url && request.headers.has("If-Match"));
    expect(puts.map((request) => request.headers.get("If-Match"))).toEqual([
      item.etag,
      a?.etag,
      b?.etag,
    ]);
    expect((await store.readTask(item.url)).task.attachments).toEqual([second]);
  });

  it.each([
    "add",
    "remove",
  ])("refreshes a conflicting %s and retries the intent on the latest links", async (operation) => {
    const { cache, inbox, store, failures, pod } = await frameCache();
    const item = await cache.createTask(inbox, { title: "Task", attachments: [first] });
    if (!item) throw new Error("Missing task");
    const remote = await store.updateTask(item, (task) => {
      task.title = "Remote title";
      task.attachments = [...task.attachments, second];
    });
    const local = "https://example.org/local";
    const change =
      operation === "add"
        ? (task: typeof item.task) => {
            task.attachments = [...task.attachments, local];
          }
        : (task: typeof item.task) => {
            task.attachments = task.attachments.filter((url) => url !== first);
          };
    expect(await cache.updateTask(item, change)).toBeUndefined();
    expect(failures).toHaveBeenCalledOnce();
    expect(failures.mock.calls[0]?.[0]).toBeInstanceOf(ModelError);
    expect(failures.mock.calls[0]?.[0].status).toBe(412);
    const refreshed = cache.getSnapshot().tasks[inbox.url]?.items[0];
    expect(refreshed?.task.attachments).toEqual([first, second]);
    expect(refreshed?.task.title).toBe("Remote title");
    const retry = failures.mock.calls[0]?.[1] as () => void;
    retry();
    await vi.waitFor(() => expect(cache.getSnapshot().saving).toEqual([]));
    expect((await store.readTask(item.url)).task.attachments).toEqual(
      operation === "add" ? [first, second, local] : [second],
    );
    const retries = pod
      .mutations()
      .filter((request) => request.url === item.url && request.headers.has("If-Match"));
    expect(retries[2]?.headers.get("If-Match")).toBe(remote.etag);
  });
});
