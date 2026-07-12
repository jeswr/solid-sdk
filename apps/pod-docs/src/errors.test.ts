import { describe, expect, it } from "vitest";
import {
  OutOfScopeError,
  PodDocsError,
  ResourceDeleteError,
  ResourceWriteError,
} from "./errors.js";

describe("errors", () => {
  it("ResourceWriteError carries url + status and is a PodDocsError", () => {
    const cause = new Error("root");
    const e = new ResourceWriteError("https://pod/x.ttl", 412, { cause });
    expect(e).toBeInstanceOf(PodDocsError);
    expect(e.name).toBe("ResourceWriteError");
    expect(e.url).toBe("https://pod/x.ttl");
    expect(e.status).toBe(412);
    expect(e.cause).toBe(cause);
    expect(e.message).toContain("412");
  });

  it("ResourceDeleteError carries url + status", () => {
    const e = new ResourceDeleteError("https://pod/x.ttl", 500);
    expect(e).toBeInstanceOf(PodDocsError);
    expect(e.name).toBe("ResourceDeleteError");
    expect(e.url).toBe("https://pod/x.ttl");
    expect(e.status).toBe(500);
    expect(e.message).toContain("500");
  });

  it("OutOfScopeError names the offending url + container", () => {
    const e = new OutOfScopeError("https://evil/y", "https://pod/pod-docs/");
    expect(e).toBeInstanceOf(PodDocsError);
    expect(e.name).toBe("OutOfScopeError");
    expect(e.url).toBe("https://evil/y");
    expect(e.container).toBe("https://pod/pod-docs/");
    expect(e.message).toContain("https://evil/y");
  });

  it("the base PodDocsError sets its name and preserves the cause option", () => {
    const cause = new Error("inner");
    const e = new PodDocsError("boom", { cause });
    expect(e.name).toBe("PodDocsError");
    expect(e.message).toBe("boom");
    expect(e.cause).toBe(cause);
  });
});
