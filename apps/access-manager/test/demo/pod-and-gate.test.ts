// AUTHORED-BY Claude Fable 5
// The demo seam's two safety properties, tested exhaustively:
//   1. the ?demo GATE — demo mode is reachable ONLY via the query param, and
//      every other URL selects the real authenticated app;
//   2. the READ-ONLY pod — the demo fetch serves fixtures on GET/HEAD and
//      THROWS on every mutating method, so no demo action can ever write.
import { describe, expect, it } from "vitest";
import {
  ADA,
  BLOOD,
  createDemoSession,
  DEMO_POD,
  DEMO_REQUEST,
  demoFixtures,
} from "../../src/demo/fixtures.js";
import { demoViewFromSearch } from "../../src/demo/gate.js";
import { createDemoPod, DemoReadOnlyError } from "../../src/demo/pod.js";

describe("demoViewFromSearch — the ?demo gate", () => {
  it("selects the REAL app (null) when no demo param is present", () => {
    expect(demoViewFromSearch("")).toBeNull();
    expect(demoViewFromSearch("?")).toBeNull();
    expect(demoViewFromSearch("?foo=1&bar=demo")).toBeNull();
    // `demo` must be the parameter NAME, not a value or substring.
    expect(demoViewFromSearch("?demonstration=1")).toBeNull();
    expect(demoViewFromSearch("?view=demo")).toBeNull();
  });

  it("defaults to the dashboard when ?demo has no value", () => {
    expect(demoViewFromSearch("?demo")).toBe("dashboard");
    expect(demoViewFromSearch("?demo=")).toBe("dashboard");
  });

  it("selects each of the four views", () => {
    expect(demoViewFromSearch("?demo=dashboard")).toBe("dashboard");
    expect(demoViewFromSearch("?demo=inbox")).toBe("inbox");
    expect(demoViewFromSearch("?demo=history")).toBe("history");
    expect(demoViewFromSearch("?demo=dataclass")).toBe("dataclass");
  });

  it("falls back to the dashboard for unknown demo values", () => {
    expect(demoViewFromSearch("?demo=bogus")).toBe("dashboard");
    expect(demoViewFromSearch("?demo=INBOX")).toBe("dashboard");
  });

  it("honours ?demo among other params", () => {
    expect(demoViewFromSearch("?theme=dark&demo=history")).toBe("history");
  });
});

describe("createDemoPod — read-only fixture serving", () => {
  it("serves a fixture on GET with an ETag and the acl Link header", async () => {
    const pod = createDemoPod(demoFixtures());
    const res = await pod.fetch(BLOOD);
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"demo"');
    expect(res.headers.get("link")).toBe(`<${BLOOD}.acl>; rel="acl"`);
    expect(await res.text()).toContain("Blood test results");
  });

  it("synthesises container listings for the fixture tree", async () => {
    const pod = createDemoPod(demoFixtures());
    const res = await pod.fetch(`${DEMO_POD}health/results/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("ldp#contains");
    expect(body).toContain("blood.ttl");
    expect(body).toContain("panel.ttl");
  });

  it("404s unknown resources", async () => {
    const pod = createDemoPod(demoFixtures());
    expect((await pod.fetch(`${DEMO_POD}nope.ttl`)).status).toBe(404);
    expect((await pod.fetch(`${DEMO_POD}empty-dir/`)).status).toBe(404);
  });

  it("strips fragments like a real fetch", async () => {
    const pod = createDemoPod(demoFixtures());
    expect((await pod.fetch(ADA)).status).toBe(200);
  });

  it("THROWS DemoReadOnlyError on every mutating method and changes nothing", async () => {
    const pod = createDemoPod(demoFixtures());
    const before = pod.body(DEMO_REQUEST);
    for (const method of ["PUT", "POST", "PATCH", "DELETE"]) {
      await expect(pod.fetch(DEMO_REQUEST, { method, body: "tampered" })).rejects.toBeInstanceOf(
        DemoReadOnlyError,
      );
    }
    // Nothing changed, and the refusal message is the one the UI surfaces.
    expect(pod.body(DEMO_REQUEST)).toBe(before);
    await expect(pod.fetch(DEMO_REQUEST, { method: "PUT" })).rejects.toThrow(
      /Demo mode — sample data only; changes are disabled\./,
    );
  });

  it("THROWS DemoReadOnlyError when the write arrives as a Request OBJECT (regression: the method must not be read from init alone)", async () => {
    const pod = createDemoPod(demoFixtures());
    const before = pod.body(DEMO_REQUEST);
    for (const method of ["PUT", "POST", "PATCH", "DELETE"]) {
      await expect(
        pod.fetch(new Request(DEMO_REQUEST, { method, body: "tampered" })),
      ).rejects.toBeInstanceOf(DemoReadOnlyError);
      // The chokepoint saw the REAL method, not a defaulted GET.
      expect(pod.log.at(-1)).toEqual({ method, url: DEMO_REQUEST });
    }
    expect(pod.body(DEMO_REQUEST)).toBe(before);
    // init.method still wins over the Request's own method (fetch semantics)…
    await expect(pod.fetch(new Request(DEMO_REQUEST), { method: "PUT" })).rejects.toBeInstanceOf(
      DemoReadOnlyError,
    );
    // …lower-case methods are normalised…
    await expect(pod.fetch(DEMO_REQUEST, { method: "put" })).rejects.toBeInstanceOf(
      DemoReadOnlyError,
    );
    // …and a plain GET/HEAD Request object still reads normally.
    expect((await pod.fetch(new Request(BLOOD))).status).toBe(200);
    expect((await pod.fetch(new Request(BLOOD, { method: "HEAD" }))).status).toBe(200);
  });

  it("even conditional writes (If-Match / If-None-Match) are refused", async () => {
    const pod = createDemoPod(demoFixtures());
    await expect(
      pod.fetch(BLOOD, { method: "PUT", headers: { "if-match": '"demo"' }, body: "x" }),
    ).rejects.toBeInstanceOf(DemoReadOnlyError);
    await expect(
      pod.fetch(`${DEMO_POD}new.ttl`, {
        method: "PUT",
        headers: { "if-none-match": "*" },
        body: "x",
      }),
    ).rejects.toBeInstanceOf(DemoReadOnlyError);
  });
});

describe("createDemoSession", () => {
  it("binds Ada's WebID to the read-only pod fetch", async () => {
    const { session, pod } = createDemoSession();
    expect(session.webId).toBe(ADA);
    const res = await session.fetch(ADA);
    expect(res.status).toBe(200);
    expect(pod.log.some((l) => l.method === "GET" && l.url === `${DEMO_POD}profile/card`)).toBe(
      true,
    );
  });
});
