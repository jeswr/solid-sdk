import { describe, it, expect, vi } from "vitest";
import { IssuesDocument } from "./issues-document";
import { ConflictError } from "./errors";

const DOC = "http://localhost:3000/alice/issue-tracker/issues.ttl";
const ME = "http://localhost:3000/alice/profile/card#me";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fake CSS: GET returns `getBody` (or 404), PUT records the call and returns `putStatus`. */
function fakeFetch(opts: { getBody?: string; getEtag?: string; putStatus?: number; putEtag?: string }) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url: String(url), method, headers, body: init?.body as string | undefined });
    if (method === "GET") {
      if (opts.getBody === undefined) return new Response("Not found", { status: 404 });
      return new Response(opts.getBody, {
        status: 200,
        headers: { "content-type": "text/turtle", ...(opts.getEtag ? { etag: opts.getEtag } : {}) },
      });
    }
    // PUT
    return new Response(null, {
      status: opts.putStatus ?? 201,
      headers: opts.putEtag ? { etag: opts.putEtag } : {},
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("IssuesDocument", () => {
  it("treats a 404 as an empty document", async () => {
    const { impl } = fakeFetch({});
    const doc = await IssuesDocument.open(DOC, impl);
    expect(doc.list()).toEqual([]);
  });

  it("creates an issue and writes it with If-None-Match on first save", async () => {
    const { impl, calls } = fakeFetch({ putEtag: '"v1"' });
    const doc = await IssuesDocument.open(DOC, impl);
    const issue = doc.create({ title: "Login is broken", description: "500 on submit", creator: ME });

    expect(issue.state).toBe("open");
    expect(issue.creator).toBe(ME);
    expect(doc.list()).toHaveLength(1);

    await doc.save();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers["if-match"]).toBeUndefined();
    expect(put.body).toContain("Login is broken");
    expect(put.body).toContain("Tracker"); // tracker config was seeded
    expect(put.body).toContain("flow#Task");
  });

  it("lists parsed issues newest-first and toggles state with If-Match", async () => {
    const turtle = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#>.
@prefix dct: <http://purl.org/dc/terms/>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
<${DOC}#issue-a> a wf:Task, wf:Open; dct:title "Older"; dct:created "2026-06-01T09:00:00Z"^^xsd:dateTime.
<${DOC}#issue-b> a wf:Task, wf:Open; dct:title "Newer"; dct:created "2026-06-08T09:00:00Z"^^xsd:dateTime.`;
    const { impl, calls } = fakeFetch({ getBody: turtle, getEtag: '"v2"', putEtag: '"v3"' });
    const doc = await IssuesDocument.open(DOC, impl);

    const titles = doc.list().map((i) => i.title);
    expect(titles).toEqual(["Newer", "Older"]);

    doc.setState(`${DOC}#issue-a`, "closed");
    expect(doc.get(`${DOC}#issue-a`)!.state).toBe("closed");

    await doc.save();
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"v2"');
    expect(put.body).toContain("flow#Closed");
  });

  it("updates fields and removes issues", async () => {
    const { impl } = fakeFetch({ putEtag: '"v1"' });
    const doc = await IssuesDocument.open(DOC, impl);
    const issue = doc.create({ title: "Typo", creator: ME });

    doc.update(issue.id, { title: "Fix typo in header", dateDue: new Date("2026-07-01") });
    expect(doc.get(issue.id)!.title).toBe("Fix typo in header");
    expect(doc.get(issue.id)!.dateDue?.getUTCFullYear()).toBe(2026);

    doc.remove(issue.id);
    expect(doc.list()).toHaveLength(0);
  });

  it("raises ConflictError on a 412 from the conditional PUT", async () => {
    const { impl } = fakeFetch({ getBody: `<${DOC}#x> a <http://www.w3.org/2005/01/wf/flow#Task>.`, getEtag: '"v2"', putStatus: 412 });
    const doc = await IssuesDocument.open(DOC, impl);
    doc.create({ title: "Race", creator: ME });
    await expect(doc.save()).rejects.toBeInstanceOf(ConflictError);
  });
});
