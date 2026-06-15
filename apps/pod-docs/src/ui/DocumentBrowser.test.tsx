// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// @vitest-environment jsdom
//
// End-to-end view tests: the REAL data layer (`DocsStore`) driven by a stubbed
// authenticated `fetch` (the auth seam), so the component, hook and data layer
// are all exercised together — no store mock. The stub serves Turtle for the
// container listing + each document, mirroring how a Solid server answers.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentBrowser } from "./DocumentBrowser.js";

const POD = "https://alice.pod/";
const WEBID = "https://alice.pod/profile/card#me";
const CONTAINER = "https://alice.pod/pod-docs/";
const DOC = "https://alice.pod/pod-docs/note-abc.ttl";
const DOC2 = "https://alice.pod/pod-docs/plan-xyz.ttl";

/** A `pd:Document` resource body. */
function docTtl(opts: {
  title?: string;
  body?: string;
  format?: string;
  creator?: string;
  modified?: string;
}): string {
  const lines = [
    "@prefix pd: <https://w3id.org/jeswr/pod-docs#> .",
    "@prefix dct: <http://purl.org/dc/terms/> .",
    "<#it> a pd:Document ;",
  ];
  const preds: string[] = [];
  if (opts.title !== undefined) preds.push(`  dct:title ${JSON.stringify(opts.title)}`);
  preds.push(`  pd:body ${JSON.stringify(opts.body ?? "")}`);
  preds.push(`  pd:format ${JSON.stringify(opts.format ?? "text/html")}`);
  if (opts.creator) preds.push(`  dct:creator <${opts.creator}>`);
  if (opts.modified)
    preds.push(`  dct:modified "${opts.modified}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`);
  return `${lines.join("\n")}\n${preds.join(" ;\n")} .\n`;
}

/** An LDP container listing body. */
function containerTtl(children: string[]): string {
  const ldp = "@prefix ldp: <http://www.w3.org/ns/ldp#> .";
  const dct = "@prefix dct: <http://purl.org/dc/terms/> .";
  const contains = children.map((c) => `<${c}>`).join(", ");
  const childDecls = children
    .map(
      (c) =>
        `<${c}> a ldp:Resource ; dct:modified "2026-06-15T10:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`,
    )
    .join("\n");
  return `${ldp}\n${dct}\n<${CONTAINER}> a ldp:Container${
    children.length ? ` ; ldp:contains ${contains}` : ""
  } .\n${childDecls}\n`;
}

/** A `fetch` stub serving a `GET <url> → Turtle|status` script. */
function fetchStub(script: Record<string, { body?: string; status?: number }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const planned = script[url];
    if (!planned || planned.status === 404) {
      return new Response("not found", { status: 404 });
    }
    if (planned.status && planned.status >= 400) {
      return new Response("err", { status: planned.status });
    }
    return new Response(planned.body ?? "", {
      status: 200,
      headers: { "content-type": "text/turtle", etag: 'W/"e"' },
    });
  }) as typeof fetch;
}

describe("DocumentBrowser — listing", () => {
  it("renders a loading state then the document list", async () => {
    const fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC, DOC2]) },
      [DOC]: { body: docTtl({ title: "My notes" }) },
      [DOC2]: { body: docTtl({ title: "Plan" }) },
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("My notes")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getAllByText("2026-06-15").length).toBeGreaterThan(0);
  });

  it("renders the empty state when the container has no documents", async () => {
    const fetch = fetchStub({ [CONTAINER]: { body: containerTtl([]) } });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("renders a custom title heading", async () => {
    const fetch = fetchStub({ [CONTAINER]: { body: containerTtl([]) } });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} title="My Library" />);
    expect(await screen.findByRole("heading", { name: "My Library" })).toBeInTheDocument();
  });

  it("falls back to the URL-tail name for an untitled document", async () => {
    const fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC]) },
      [DOC]: { body: docTtl({ body: "x" }) }, // no dct:title
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(await screen.findByText("note-abc.ttl")).toBeInTheDocument();
  });
});

describe("DocumentBrowser — error states", () => {
  it("renders a 401 access error WITHOUT a retry button", async () => {
    // The container GET 401s — DocsStore.list propagates 401 (only 403/404 → []).
    const fetch = fetchStub({ [CONTAINER]: { status: 401 } });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/log in/i);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("renders a generic error WITH a retry that re-lists", async () => {
    let attempt = 0;
    const retryFetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === CONTAINER) {
        attempt += 1;
        if (attempt === 1) return new Response("boom", { status: 500 });
        return new Response(containerTtl([DOC]), {
          status: 200,
          headers: { "content-type": "text/turtle" },
        });
      }
      return new Response(docTtl({ title: "My notes" }), {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }) as typeof globalThis.fetch;
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={retryFetch} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("My notes")).toBeInTheDocument();
  });
});

describe("DocumentBrowser — opening + navigating", () => {
  it("opens a document read-only then returns to the list", async () => {
    const fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC]) },
      [DOC]: {
        body: docTtl({
          title: "My notes",
          body: "the body content",
          format: "text/markdown",
          creator: WEBID,
        }),
      },
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);

    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));

    expect(await screen.findByText("the body content")).toBeInTheDocument();
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
    expect(screen.getByText(WEBID)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back to documents/i }));
    expect(await screen.findByText("My notes")).toBeInTheDocument();
  });

  it("renders the body as escaped TEXT, never injected HTML (XSS guard)", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC]) },
      [DOC]: { body: docTtl({ title: "My notes", body: hostile, format: "text/html" }) },
    });
    const { container } = render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));
    expect(await screen.findByText(hostile)).toBeInTheDocument();
    // The hostile markup is NOT parsed into a live <img> in the document.
    expect(container.querySelector("img")).toBeNull();
  });

  it("omits the author row when the document has no creator", async () => {
    const fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC]) },
      [DOC]: { body: docTtl({ title: "My notes", body: "hello body text" }) }, // no creator
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));
    await screen.findByText("hello body text");
    expect(screen.queryByText("Author")).not.toBeInTheDocument();
  });
});

describe("DocumentBrowser — global-fetch fallback", () => {
  it("falls back to the ambient global fetch when no fetch prop is given", async () => {
    // No `fetch` prop → the data layer uses globalThis.fetch. We stub the global
    // so the omit-fetch path is exercised end to end (the production path where
    // @solid/reactive-authentication has patched the global).
    const original = globalThis.fetch;
    globalThis.fetch = fetchStub({
      [CONTAINER]: { body: containerTtl([DOC]) },
      [DOC]: { body: docTtl({ title: "Global Doc" }) },
    });
    try {
      render(<DocumentBrowser podRoot={POD} webId={WEBID} />);
      expect(await screen.findByText("Global Doc")).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });
});
