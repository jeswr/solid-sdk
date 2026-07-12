// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  OutOfScopeError,
  PodChatError,
  ResourceDeleteError,
  ResourceWriteError,
} from "./errors.js";

describe("PodChatError", () => {
  it("is the base class for every typed error", () => {
    expect(new ResourceWriteError("u", 500)).toBeInstanceOf(PodChatError);
    expect(new ResourceDeleteError("u", 500)).toBeInstanceOf(PodChatError);
    expect(new OutOfScopeError("u", "c")).toBeInstanceOf(PodChatError);
  });

  it("carries the message and name", () => {
    const e = new PodChatError("boom");
    expect(e.message).toBe("boom");
    expect(e.name).toBe("PodChatError");
  });

  it("forwards the cause option", () => {
    const cause = new Error("root");
    const e = new PodChatError("wrap", { cause });
    expect(e.cause).toBe(cause);
  });
});

describe("ResourceWriteError", () => {
  it("captures url + status in the message and fields", () => {
    const e = new ResourceWriteError("https://pod/x.ttl", 412);
    expect(e.url).toBe("https://pod/x.ttl");
    expect(e.status).toBe(412);
    expect(e.name).toBe("ResourceWriteError");
    expect(e.message).toContain("412");
    expect(e.message).toContain("https://pod/x.ttl");
  });

  it("forwards the cause option", () => {
    const cause = new Error("net");
    const e = new ResourceWriteError("u", 500, { cause });
    expect(e.cause).toBe(cause);
  });
});

describe("ResourceDeleteError", () => {
  it("captures url + status", () => {
    const e = new ResourceDeleteError("https://pod/x.ttl", 500);
    expect(e.url).toBe("https://pod/x.ttl");
    expect(e.status).toBe(500);
    expect(e.name).toBe("ResourceDeleteError");
    expect(e.message).toContain("500");
  });

  it("forwards the cause option", () => {
    const cause = new Error("net");
    const e = new ResourceDeleteError("u", 500, { cause });
    expect(e.cause).toBe(cause);
  });
});

describe("OutOfScopeError", () => {
  it("captures url + container", () => {
    const e = new OutOfScopeError("https://evil/x", "https://pod/pod-chat/rooms/");
    expect(e.url).toBe("https://evil/x");
    expect(e.container).toBe("https://pod/pod-chat/rooms/");
    expect(e.name).toBe("OutOfScopeError");
    expect(e.message).toContain("https://evil/x");
  });
});
