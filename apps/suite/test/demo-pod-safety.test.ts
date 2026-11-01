// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://atomic.test/";

describe("atomic demo pod preconditions", () => {
  it("allocates distinct slugs to concurrent POSTs", async () => {
    const pod = createDemoPod({ root: ROOT });
    const responses = await Promise.all(
      ["first", "second"].map((body) =>
        pod.fetch(ROOT, { method: "POST", headers: { slug: "same" }, body }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses.map((r) => r.headers.get("location"))).toEqual([
      `${ROOT}same`,
      `${ROOT}same-1`,
    ]);
    expect(await (await pod.fetch(`${ROOT}same`)).text()).toBe("first");
    expect(await (await pod.fetch(`${ROOT}same-1`)).text()).toBe("second");
  });

  it("reads legacy container validators and changes them even with a fixed clock and unchanged child count", async () => {
    const pod = createDemoPod({
      root: ROOT,
      now: () => 1,
      snapshot: {
        version: 1,
        etagSeq: 0,
        resources: [],
        containers: [[ROOT, { modified: 1, created: 1 }]],
      },
    });
    const legacy = await pod.fetch(ROOT);
    expect(legacy.headers.get("etag")).toBe('"demo-c-1-0"');
    await pod.fetch(`${ROOT}a`, { method: "PUT", body: "a" });
    const before = (await pod.fetch(ROOT)).headers.get("etag");
    await pod.fetch(`${ROOT}a`, { method: "DELETE" });
    await pod.fetch(`${ROOT}b`, { method: "PUT", body: "b" });
    expect((await pod.fetch(ROOT)).headers.get("etag")).not.toBe(before);
  });
  it("allows exactly one concurrent conditional create after body conversion", async () => {
    const pod = createDemoPod({ root: ROOT });
    const responses = await Promise.all(
      ["first", "second"].map((body) =>
        pod.fetch(`${ROOT}file`, {
          method: "PUT",
          headers: { "if-none-match": "*" },
          body: new Blob([body]),
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 412]);
    expect(await (await pod.fetch(`${ROOT}file`)).text()).toBe("first");
  });

  it("allows exactly one concurrent overwrite for the same ETag", async () => {
    const pod = createDemoPod({ root: ROOT });
    const original = await pod.fetch(`${ROOT}file`, { method: "PUT", body: "old" });
    const responses = await Promise.all(
      ["first", "second"].map((body) =>
        pod.fetch(`${ROOT}file`, {
          method: "PUT",
          headers: { "if-match": original.headers.get("etag") as string },
          body: new Blob([body]),
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([205, 412]);
  });

  it("applies DELETE version preconditions", async () => {
    const pod = createDemoPod({ root: ROOT });
    await pod.fetch(`${ROOT}file`, { method: "PUT", body: "new" });
    expect(
      (await pod.fetch(`${ROOT}file`, { method: "DELETE", headers: { "if-match": '"old"' } }))
        .status,
    ).toBe(412);
    expect(pod.has(`${ROOT}file`)).toBe(true);
  });
});
