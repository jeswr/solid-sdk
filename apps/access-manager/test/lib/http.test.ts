// AUTHORED-BY Claude Fable 5
// Conditional-write semantics through the stubbed pod: the CAS primitive the
// whole approval pipeline rests on (If-Match / If-None-Match / 412 mapping).
import { describe, expect, it } from "vitest";
import {
  isHttpUrl,
  PreconditionFailedError,
  putIfMatch,
  putIfNoneMatch,
  readRdf,
  WriteFailedError,
} from "../../src/lib/http.js";
import { createPodStub } from "../pod-stub.js";

const URL_A = "https://pod.example/a.ttl";

describe("isHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isHttpUrl("https://x.example/")).toBe(true);
    expect(isHttpUrl("http://x.example/")).toBe(true);
    expect(isHttpUrl("ftp://x.example/")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("readRdf", () => {
  it("returns dataset + etag; null on 404", async () => {
    const pod = createPodStub({ [URL_A]: "<https://x.example/s> a <https://x.example/T> ." });
    const read = await readRdf(URL_A, pod.fetch);
    expect(read).not.toBeNull();
    expect(read?.etag).toBe('"v1"');
    expect(read?.dataset.size).toBe(1);
    expect(await readRdf("https://pod.example/missing.ttl", pod.fetch)).toBeNull();
  });
});

describe("putIfMatch", () => {
  it("succeeds with the current etag and bumps the version", async () => {
    const pod = createPodStub({ [URL_A]: "<https://x.example/s> a <https://x.example/T> ." });
    await putIfMatch(URL_A, "<https://x.example/s2> a <https://x.example/T> .", '"v1"', pod.fetch);
    expect(pod.etag(URL_A)).toBe('"v2"');
    expect(pod.body(URL_A)).toContain("s2");
  });

  it("throws PreconditionFailedError on a stale etag (lost race)", async () => {
    const pod = createPodStub({ [URL_A]: "<https://x.example/s> a <https://x.example/T> ." });
    pod.seed(URL_A, "<https://x.example/racer> a <https://x.example/T> ."); // concurrent writer → v2
    await expect(putIfMatch(URL_A, "mine", '"v1"', pod.fetch)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(pod.body(URL_A)).toContain("racer"); // the winner's write survives
  });

  it("degrades to unconditional PUT when the server sent no etag", async () => {
    const pod = createPodStub();
    await putIfMatch(URL_A, "<https://x.example/s> a <https://x.example/T> .", null, pod.fetch);
    expect(pod.has(URL_A)).toBe(true);
  });

  it("maps other failures to WriteFailedError", async () => {
    const pod = createPodStub();
    pod.intercept = () => new Response("nope", { status: 500 });
    await expect(putIfMatch(URL_A, "x", null, pod.fetch)).rejects.toBeInstanceOf(WriteFailedError);
  });
});

describe("putIfNoneMatch (create-only)", () => {
  it("creates when absent; 412 when present", async () => {
    const pod = createPodStub();
    await putIfNoneMatch(URL_A, "<https://x.example/s> a <https://x.example/T> .", pod.fetch);
    expect(pod.has(URL_A)).toBe(true);
    await expect(putIfNoneMatch(URL_A, "other", pod.fetch)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(pod.body(URL_A)).toContain("x.example/s"); // first write survives
  });
});

describe("isWithinStorage (roborev: startsWith is not containment)", () => {
  it("accepts genuine descendants", async () => {
    const { isWithinStorage } = await import("../../src/lib/http.js");
    expect(isWithinStorage("https://pod.example/a/b.ttl", "https://pod.example/")).toBe(true);
    expect(isWithinStorage("https://pod.example/foo/x", "https://pod.example/foo/")).toBe(true);
    expect(isWithinStorage("https://pod.example/foo/", "https://pod.example/foo")).toBe(true);
  });

  it("rejects sibling-prefix and cross-origin tricks", async () => {
    const { isWithinStorage } = await import("../../src/lib/http.js");
    // Root missing its trailing slash must NOT match a sibling path prefix…
    expect(isWithinStorage("https://pod.example/foo-bar/x", "https://pod.example/foo")).toBe(false);
    // …nor a hostname-prefix attack…
    expect(isWithinStorage("https://pod.example.evil/x", "https://pod.example/")).toBe(false);
    // …nor another origin, port, or scheme.
    expect(isWithinStorage("https://other.example/x", "https://pod.example/")).toBe(false);
    expect(isWithinStorage("https://pod.example:8443/x", "https://pod.example/")).toBe(false);
    expect(isWithinStorage("file:///etc/passwd", "https://pod.example/")).toBe(false);
    expect(isWithinStorage("not a url", "https://pod.example/")).toBe(false);
  });
});
