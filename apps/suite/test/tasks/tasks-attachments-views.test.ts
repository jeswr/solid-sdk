// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { hrefFor } from "../../src/apps/drive/lib/files/urls";
import {
  attachmentCount,
  attachmentView,
  attachmentViews,
} from "../../src/apps/tasks/lib/views/attachments";
import { encodeRef } from "../../src/lib/refs";
import { storage } from "./pod";
import { frameCache } from "./tasks-frame-fixtures";

describe("attachment presentation", () => {
  it.each([
    ["https://example.org/Project%20brief.pdf?download=1#page=2", "Project brief.pdf"],
    ["https://example.org/%E2%9C%93.txt", "✓.txt"],
    ["https://example.org/folder/", "folder"],
    ["https://example.org/", "example.org"],
    ["https://example.org/bad%escape", "bad%escape"],
  ])("renders the decoded final segment of %s", (url, name) => {
    expect(attachmentView(url)).toEqual({ url, name, href: url });
  });

  it("uses the existing Drive helper for files and folders in the active pod", () => {
    const file = `${storage}drive/brief.pdf?download=1#page=2`;
    const folder = `${storage}drive/briefs/`;
    expect(attachmentView(file, storage).href).toBe(`/drive/p/${encodeRef(file)}`);
    expect(attachmentView(folder, storage).href).toBe(`/drive/f/${encodeRef(folder)}`);
    expect(attachmentView(file, storage.slice(0, -1)).href).toBe(
      hrefFor({ url: file, kind: "file" }),
    );
    expect(attachmentView("https://pod.test/alice-other/file", storage).href).toBe(
      "https://pod.test/alice-other/file",
    );
    expect(attachmentView("https://pod.test/bob/file", storage).href).toBe(
      "https://pod.test/bob/file",
    );
    expect(attachmentView("http://pod.test/alice/file", storage).href).toBe(
      "http://pod.test/alice/file",
    );
    expect(attachmentView("https://elsewhere.test/alice/file", storage).href).toBe(
      "https://elsewhere.test/alice/file",
    );
  });

  it("projects zero for an unloaded task and counts only safe stored links", async () => {
    const { store, inbox } = await frameCache();
    expect(attachmentCount(undefined)).toBe(0);
    const item = await store.createTask(inbox, { title: "Task", state: "open" });
    expect(attachmentCount(item)).toBe(0);
    item.task.attachments = ["https://example.org/one", "https://example.org/two"];
    expect(attachmentCount(item)).toBe(2);
    expect(attachmentViews(item)).toEqual([
      { url: "https://example.org/one", name: "one", href: "https://example.org/one" },
      { url: "https://example.org/two", name: "two", href: "https://example.org/two" },
    ]);
  });
});
