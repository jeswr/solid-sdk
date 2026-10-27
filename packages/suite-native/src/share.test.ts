// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test, vi } from "vitest";
import { ShareUnavailableError } from "./errors.js";
import { type SharePlugin, share } from "./share.js";

const native = (canShare = true, result: { activityType?: string } = {}) => ({
  canShare: vi.fn(async () => ({ value: canShare })),
  share: vi.fn(async () => result),
});

describe("validation", () => {
  test.each([
    ["nothing", {}],
    ["empty files only", { files: [] }],
    ["non-string title", { title: 5 as unknown as string }],
    ["huge text", { text: "x".repeat(10_001) }],
    ["relative url", { url: "/drive" }],
    ["http url", { url: "http://pod.example/a" }],
    ["url with credentials", { url: "https://me:pw@pod.example/a" }],
    ["too many files", { files: Array.from({ length: 21 }, (_, i) => `file:///f${i}`) }],
    ["non-file path", { files: ["content://x"] }],
  ])("rejects %s", async (_, content) => {
    await expect(share(content, { native: native() })).rejects.toBeInstanceOf(TypeError);
  });
});

describe("native share sheet", () => {
  test("shares natively and reports the activity", async () => {
    const plugin = native(true, { activityType: "com.apple.UIKit.activity.Mail" });
    const content = {
      title: "Doc",
      url: "https://pod.example/doc",
      files: ["file:///cache/a.pdf"],
    };
    await expect(share(content, { native: plugin })).resolves.toEqual({
      completed: true,
      activityType: "com.apple.UIKit.activity.Mail",
    });
    expect(plugin.share).toHaveBeenCalledWith(content);
  });

  test("reports completion without an activity type", async () => {
    await expect(share({ text: "hi" }, { native: native() })).resolves.toEqual({ completed: true });
  });

  test("treats a cancelled native sheet as not completed", async () => {
    const plugin = native();
    plugin.share.mockRejectedValue(new Error("Share canceled"));
    await expect(share({ text: "hi" }, { native: plugin })).resolves.toEqual({ completed: false });
  });

  test("wraps other native failures", async () => {
    const plugin: SharePlugin = { canShare: async () => Promise.reject(null), share: vi.fn() };
    await expect(share({ text: "hi" }, { native: plugin })).rejects.toBeInstanceOf(
      ShareUnavailableError,
    );
  });

  test("falls back to the web when the native sheet cannot share", async () => {
    const web = { share: vi.fn(async () => undefined) };
    await expect(share({ text: "hi" }, { native: native(false), web })).resolves.toEqual({
      completed: true,
    });
    expect(web.share).toHaveBeenCalledWith({ title: undefined, text: "hi", url: undefined });
  });
});

describe("web share fallback", () => {
  test("treats AbortError as not completed", async () => {
    const web = { share: vi.fn(async () => Promise.reject(new DOMException("x", "AbortError"))) };
    await expect(share({ url: "https://pod.example/a" }, { web })).resolves.toEqual({
      completed: false,
    });
  });

  test("cannot share files on the web", async () => {
    const web = { share: vi.fn() };
    await expect(share({ files: ["file:///a"] }, { web })).rejects.toBeInstanceOf(
      ShareUnavailableError,
    );
    expect(web.share).not.toHaveBeenCalled();
  });

  test("throws ShareUnavailableError without any share sheet", async () => {
    await expect(share({ text: "hi" }, {})).rejects.toBeInstanceOf(ShareUnavailableError);
    await expect(share({ text: "hi" }, { web: {} })).rejects.toBeInstanceOf(ShareUnavailableError);
  });

  test("wraps unexpected web failures", async () => {
    const web = { share: vi.fn(async () => Promise.reject(new TypeError("bad"))) };
    await expect(share({ text: "hi" }, { web })).rejects.toBeInstanceOf(ShareUnavailableError);
  });
});
