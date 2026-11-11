// AUTHORED-BY Codex GPT-6.1-Sol
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskComments } from "../../src/apps/tasks/components/detail/comments";
import { TaskCommentStore } from "../../src/apps/tasks/lib/model/comments";
import { memberName } from "../../src/apps/tasks/lib/views/member-name";
import { act, click, deferred, h, mount } from "../drive-ui-dom";
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
async function shortcut(label = "Comment", metaKey = false, isComposing = false) {
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
describe("task comment UI", () => {
  it("loads only on mount and supports Comment, Reply, Edit and Delete by keyboard", async () => {
    const fixture = await setup();
    expect(
      fixture.pod.requests.some((request) => request.url.startsWith(fixture.comments.container)),
    ).toBe(false);
    const { host } = await fixture.render();
    await settle();
    expect(host.textContent).toContain("No comments yet");
    expect(button("Comment").disabled).toBe(true);
    await act(() => field().focus());
    await type("Root");
    await shortcut();
    await settle();
    expect((await fixture.comments.list())[0]?.root.text).toBe("Root");
    expect(field().value).toBe("");
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    const reply = button("Reply");
    await click(reply);
    expect(document.activeElement).toBe(field("Reply"));
    await type("Answer", "Reply");
    await shortcut("Reply", true);
    await settle();
    expect((await fixture.comments.list())[0]?.replies[0]?.text).toBe("Answer");
    await vi.waitFor(() => expect(document.activeElement).toBe(reply));
    await click(button("Edit"));
    expect(document.activeElement).toBe(field("Edit comment"));
    await type("Changed", "Edit comment");
    await click(button("Save"));
    await settle();
    expect((await fixture.comments.list())[0]?.root.text).toBe("Changed");
    await click(button("Delete"));
    await settle();
    expect(host.textContent).toContain("[Comment deleted]");
    expect(host.textContent).toContain("Answer");
    expect(document.activeElement).toBe(host.querySelector("h3"));
    expect(host.querySelector("time")?.getAttribute("datetime")).toBeTruthy();
  });

  it("uses the assignment name helper, plain text and safe http(s) links, with own-only controls", async () => {
    const fixture = await setup();
    const other = new TaskCommentStore(
      fixture.inbox,
      fixture.task,
      "https://bob.test/profile#me",
      fixture.pod.fetch,
    );
    await other.create(
      "<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,bad https://example.org/path http://example.org/ <https://>",
    );
    const { host } = await fixture.render();
    await settle();
    expect(host.textContent).toContain(memberName("https://bob.test/profile#me"));
    expect(memberName("invalid")).toBe("invalid");
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(host.querySelector("img")).toBeNull();
    expect([...host.querySelectorAll("a")].map((node) => node.href)).toEqual([
      "https://example.org/path",
      "http://example.org/",
    ]);
    for (const link of host.querySelectorAll("a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noopener noreferrer");
    }
    expect(
      [...host.querySelectorAll("button")].some((node) =>
        ["Edit", "Delete"].includes(node.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("shows loading and inline listing errors with Retry", async () => {
    const fixture = await setup();
    const gate = deferred<Response | undefined>();
    fixture.pod.intercept = (request) =>
      request.url === fixture.comments.container ? gate.promise : undefined;
    const { host } = await fixture.render();
    expect(host.textContent).toContain("Loading comments…");
    await act(() => gate.resolve(new Response(null, { status: 503 })));
    await settle();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    fixture.pod.intercept = undefined;
    await click(button("Retry"));
    await settle();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("No comments yet");
  });

  it("keeps denied drafts and shows the permission toast", async () => {
    const fixture = await setup();
    const { host } = await fixture.render();
    await settle();
    fixture.pod.intercept = (request) =>
      request.method === "PUT" ? new Response(null, { status: 403 }) : undefined;
    await type("Draft");
    await shortcut();
    await settle();
    expect(field().value).toBe("Draft");
    expect(toast.error).toHaveBeenCalledWith("You don't have permission to do that");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "You don't have permission",
    );
    fixture.pod.intercept = undefined;
    await click(button("Comment"));
    await settle();
    expect((await fixture.comments.list())[0]?.root.text).toBe("Draft");
  });

  it("guards composition and duplicate submissions; Escape cancels a reply and restores focus", async () => {
    const fixture = await setup();
    await fixture.comments.create("Root");
    await fixture.render();
    await settle();
    const reply = button("Reply");
    await click(reply);
    await type("Draft", "Reply");
    const before = fixture.pod.mutations().length;
    await shortcut("Reply", false, true);
    expect(fixture.pod.mutations()).toHaveLength(before);
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    await act(() =>
      field("Reply").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    window.removeEventListener("keydown", bubbled);
    expect(bubbled).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(reply));
    const gate = deferred<Response | undefined>();
    fixture.pod.intercept = (request) => (request.method === "PUT" ? gate.promise : undefined);
    await type("Submit once");
    await shortcut();
    await shortcut();
    expect(button("Comment").disabled).toBe(true);
    await act(() => gate.resolve(undefined));
    await settle();
    expect(await fixture.comments.list()).toHaveLength(2);
  });
});
