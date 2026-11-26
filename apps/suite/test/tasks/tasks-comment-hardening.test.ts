// AUTHORED-BY Claude Sonnet 5.5
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskComments } from "../../src/apps/tasks/components/detail/comments";
import { act, click, h, mount } from "../drive-ui-dom";
import { webId } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

let context: { cache: Awaited<ReturnType<typeof frameCache>>["cache"]; webId: string };
vi.mock("../../src/apps/tasks/state/tasks-context", () => ({ useTasks: () => context }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: { error: vi.fn() },
}));

import { toast } from "@jeswr/suite-ui";

beforeEach(() => {
  vi.stubGlobal("HTMLTextAreaElement", window.HTMLTextAreaElement);
  vi.mocked(toast.error).mockClear();
});
function button(name: string, parent: ParentNode = document) {
  const result = [...parent.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === name,
  );
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}
function field(label = "Comment") {
  const element = [...document.querySelectorAll("label")].find(
    (node) => node.textContent === label,
  );
  const result = element && document.getElementById(element.htmlFor);
  if (!(result instanceof HTMLTextAreaElement)) throw new Error(`Missing ${label}`);
  return result;
}
async function type(value: string, label = "Comment") {
  await act(() => {
    const input = field(label);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function _shortcut(label = "Comment", metaKey = false, isComposing = false) {
  await act(() =>
    field(label).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: !metaKey,
        metaKey,
        isComposing,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
const settle = () =>
  act(() =>
    vi.waitFor(() =>
      expect(document.querySelector(".tsk-comments")?.getAttribute("aria-busy")).toBe("false"),
    ),
  );
async function setup() {
  const fixture = await frameCache();
  context = { cache: fixture.cache, webId };
  const task = await fixture.store.createTask(fixture.inbox, { state: "open", title: "Discuss" });
  const comments = fixture.store.comments(fixture.inbox, task);
  return {
    ...fixture,
    task,
    comments,
    render: () => mount(h(TaskComments, { stored: task, project: fixture.inbox })),
  };
}
describe("task comment hardening", () => {
  it("renders the pane without comments when the store cannot be constructed", async () => {
    const fixture = await setup();
    fixture.inbox.tracker.stateStore = "bad";
    const { host } = await mount(h(TaskComments, { stored: fixture.task, project: fixture.inbox }));
    expect(host.textContent).toContain("Comments aren't available");
  });
  it("keeps the editor and draft when its comment fails to load on refresh", async () => {
    const fixture = await setup();
    const original = await fixture.comments.create("Original");
    const { host } = await fixture.render();
    await settle();
    await click(button("Edit"));
    await type("My draft", "Edit comment");
    fixture.pod.intercept = (request) =>
      request.url === original.url ? new Response(null, { status: 503 }) : undefined;
    await act(() => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(field("Edit comment").value).toBe("My draft");
    expect(host.textContent).not.toBeNull();
  });
  it("refuses over-long bodies on write and reads them as malformed", async () => {
    const { comments, pod } = await setup();
    await expect(comments.create("x".repeat(10_001))).rejects.toThrow("limited to 10,000");
    const ok = await comments.create("x".repeat(10_000));
    await expect(comments.edit(ok, "y".repeat(10_001))).rejects.toThrow("limited to 10,000");
    const file = pod.files.get(ok.url);
    if (!file) throw new Error("missing");
    pod.seed(ok.url, file.body.replace("x".repeat(10_000), "x".repeat(10_001)));
    expect(await comments.list()).toEqual([]);
  });
  it("reads at most 500 comment resources per listing", async () => {
    const { comments, pod } = await setup();
    const first = await comments.create("seed");
    const file = pod.files.get(first.url);
    if (!file) throw new Error("missing");
    for (let i = 0; i < 520; i++)
      pod.seed(
        first.url.replace(/[^/]+\.ttl$/, `c${String(i).padStart(4, "0")}.ttl`),
        file.body.replaceAll(first.url, "urn:x"),
      );
    pod.requests.length = 0;
    await comments.list();
    expect(
      pod.requests.filter((request) => request.url.endsWith(".ttl")).length,
    ).toBeLessThanOrEqual(500);
  });
  it("deletes a deleted task's comments and replies but not other tasks'", async () => {
    const { store, inbox, comments, task, pod } = await setup();
    const other = await store.createTask(inbox, { state: "open", title: "Other" });
    const keep = await store.comments(inbox, other).create("Keep");
    const root = await comments.create("Gone");
    const reply = await comments.reply(root, "Gone too");
    await store.deleteTask(task);
    expect(pod.files.has(root.url)).toBe(false);
    expect(pod.files.has(reply.url)).toBe(false);
    expect(pod.files.has(keep.url)).toBe(true);
    expect(store.commentCleanupPending).toEqual([]);
  });
  it("keeps the task delete and retries comment cleanup when a comment DELETE fails", async () => {
    const { store, comments, task, pod } = await setup();
    const root = await comments.create("Gone");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    pod.intercept = (request) =>
      request.method === "DELETE" && request.url === root.url
        ? new Response(null, { status: 503 })
        : undefined;
    await store.deleteTask(task);
    expect(pod.files.has(task.url)).toBe(false);
    expect(pod.files.has(root.url)).toBe(true);
    expect(store.commentCleanupPending).toEqual([task.url]);
    pod.intercept = undefined;
    await store.retryCommentCleanup();
    expect(pod.files.has(root.url)).toBe(false);
    expect(store.commentCleanupPending).toEqual([]);
    warn.mockRestore();
  });
});
