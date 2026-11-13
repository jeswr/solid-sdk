// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { addNavigationInputs, sortLinks } from "../src/navigation-inputs.js";
import { clusterRequests, collectKnownIds, mergeCandidates } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";

const origin = "https://forum.test";
const html =
  '<nav><div><button aria-label="Sort by: New">New</button><ul><li><a href="/topics/example/new">New</a></li><li><a href="/topics/example/top">Top</a></li></ul></div><a rel="next" href="/topics/example/new?next%5Bid%5D=50">More</a></nav>';
const requests: RecordedRequest[] = ["new", "top"].map((sort, seq) => ({
  seq,
  phase: "crawl",
  method: "GET",
  url: `${origin}/topics/example/${sort}`,
  resourceType: "document",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "text/html",
  bodySample: html,
}));
it("learns explicit sort choices and paging cursors without turning the next cursor into a default", () => {
  const ids = collectKnownIds(requests);
  const c = clusterRequests(requests, origin, ids)[0];
  if (!c) throw new Error("missing read");
  const learned = addNavigationInputs(c, [{ url: requests[0]?.url ?? origin, html }]);
  expect(learned.urlTemplate).toBe(`${origin}/topics/example/{sort}{?next%5Bid%5D}`);
  expect(learned.params.find((p) => p.name === "sort")?.options).toEqual(["new", "top"]);
  expect(learned.params.find((p) => p.name === "next%5Bid%5D")?.required).toBe(false);
  expect(sortLinks(html)).toHaveLength(2);
});

it("does not turn a root navigation route into an identifier when it is the default sort link", () => {
  const body = html.replace("<ul>", '<ul><li><a href="/topics">Default</a></li>');
  expect(
    collectKnownIds([{ ...requests[0], bodySample: body } as RecordedRequest]).has("topics"),
  ).toBe(false);
});

it("keeps sort routes separate from numeric detail routes during clustering and merging", () => {
  const detail = { ...requests[0], url: `${origin}/topics/example/42` } as RecordedRequest;
  const traffic = [...requests, detail];
  const learned = mergeCandidates(clusterRequests(traffic, origin, collectKnownIds(traffic)));
  expect(learned).toHaveLength(2);
  expect(learned.map((c) => c.urlTemplate).sort()).toEqual([
    `${origin}/topics/example/{id}`,
    `${origin}/topics/example/{sort}`,
  ]);
});

it("does not turn next-link session decoration into a planner input or example", () => {
  const c = clusterRequests(requests, origin, collectKnownIds(requests))[0];
  if (!c) throw new Error("missing read");
  c.csrf.push({
    source: { kind: "cookie", name: "sid" },
    target: { kind: "query", name: "ticket" },
  });
  const page = {
    url: requests[0]?.url ?? origin,
    html: html.replace(
      "next%5Bid%5D=50",
      "next%5Bid%5D=50&amp;ticket=secret-session-ticket&amp;_token=secret-token-value",
    ),
  };
  const learned = addNavigationInputs(c, [page]);
  expect(learned.params.some((p) => ["ticket", "_token"].includes(p.name))).toBe(false);
  expect(JSON.stringify(learned.params)).not.toContain("secret-");
});
