// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { PageData } from "@jeswr/solid-publish";
import { describe, expect, it, vi } from "vitest";
import {
  draftKey,
  editorDraft,
  editorPage,
  forgetDraft,
  keepDraft,
  recoverDraft,
} from "../src/apps/publish/lib/editor";

const at = new Date("2026-11-10T10:00:00Z");
const page: PageData = {
  title: "Title",
  slug: "title",
  body: "",
  summary: "",
  kind: "page",
  status: "draft",
  position: 0,
  modified: at,
};
describe("Publish editor and device drafts", () => {
  it("round-trips editor fields, clears images and validates before save", () => {
    const form = editorDraft(page);
    expect(form).toEqual({
      title: "Title",
      slug: "title",
      body: "",
      summary: "",
      image: "",
      keywords: "",
    });
    const full = { ...page, image: "https://images.example/a.jpg", keywords: ["one", "two"] };
    expect(editorDraft(full).keywords).toBe("one, two");
    const saved = editorPage(
      full,
      { ...editorDraft(full), image: "", body: "**bold**", keywords: " one, two, ,one " },
      at,
    );
    expect(saved.image).toBeUndefined();
    expect(saved.keywords).toEqual(["one", "two"]);
    expect(saved.body).toBe("**bold**");
    expect(
      editorPage(page, { ...form, image: "https://images.example/a.jpg" }, at).image,
    ).toContain("images.example");
    for (const image of ["data:image/png,x", "javascript:x", "/relative.png"])
      expect(() => editorPage(page, { ...form, image }, at)).toThrow(/image URL/);
    expect(() => editorPage(page, { ...form, slug: "Bad/slug" }, at)).toThrow();
    expect(() => editorPage(page, { ...form, title: "" }, at)).toThrow();
  });
  it("scopes durable drafts by identity, mode, storage and page", () => {
    const key = draftKey(
      "https://one.example/#me",
      "demo:https://pod.example/",
      "https://pod.example/page",
    );
    expect(key).not.toBe(
      draftKey("https://two.example/#me", "demo:https://pod.example/", "https://pod.example/page"),
    );
    expect(key).not.toBe(
      draftKey("https://one.example/#me", "solid:https://pod.example/", "https://pod.example/page"),
    );
    expect(key).not.toBe(
      draftKey("https://one.example/#me", "demo:https://pod.example/", "https://pod.example/other"),
    );
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    };
    const form = { ...editorDraft(page), title: "2026-01-01", body: "Offline work\n**preserved**" };
    expect(keepDraft(storage, key, form)).toBe(true);
    expect(recoverDraft(storage, key, editorDraft(page))).toEqual(form);
    expect(typeof recoverDraft(storage, key, editorDraft(page)).title).toBe("string");
    expect(recoverDraft(storage, "another", editorDraft(page))).toEqual(editorDraft(page));
    storage.setItem("another", storage.getItem(key) as string);
    expect(recoverDraft(storage, "another", editorDraft(page))).toEqual(editorDraft(page));
  });
  it("handles unavailable storage, quotas, corrupt envelopes and malformed fields", () => {
    const fallback = editorDraft(page);
    const key = "key";
    expect(recoverDraft(undefined, key, fallback)).toBe(fallback);
    expect(keepDraft(undefined, key, fallback)).toBe(false);
    expect(() => forgetDraft(undefined, key)).not.toThrow();
    expect(() =>
      forgetDraft(
        {
          removeItem() {
            throw new Error("denied");
          },
        },
        key,
      ),
    ).not.toThrow();
    const remove = { removeItem: vi.fn() };
    forgetDraft(remove, key);
    expect(remove.removeItem).toHaveBeenCalledWith(key);
    expect(
      recoverDraft(
        {
          getItem() {
            throw new Error("denied");
          },
        },
        key,
        fallback,
      ),
    ).toBe(fallback);
    expect(
      keepDraft(
        {
          setItem() {
            throw new Error("quota");
          },
        },
        key,
        fallback,
      ),
    ).toBe(false);
    for (const raw of [
      "",
      "{",
      "null",
      "0",
      "[]",
      '{"key":"wrong","draft":{}}',
      '{"key":"key"}',
      '{"key":"key","draft":null}',
      '{"key":"key","draft":{"title":12}}',
    ])
      expect(recoverDraft({ getItem: () => raw }, key, fallback)).toBe(fallback);
  });
});
