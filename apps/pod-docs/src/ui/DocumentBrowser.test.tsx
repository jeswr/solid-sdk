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
    const { container } = render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);

    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));

    // The persisted body is rendered in the read-only <pre> AND seeded into the
    // editor textarea — assert the <pre> specifically (the body appears twice).
    await screen.findByText("text/markdown");
    expect(container.querySelector(".pod-docs-body")?.textContent).toBe("the body content");
    expect((container.querySelector(".pod-docs-edit-body") as HTMLTextAreaElement)?.value).toBe(
      "the body content",
    );
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
    // The hostile string is rendered as ESCAPED TEXT in the <pre> and seeded as
    // an inert textarea value — never parsed into live markup.
    const pre = await screen.findByText(hostile, { selector: ".pod-docs-body" });
    expect(pre).toBeInTheDocument();
    expect((container.querySelector(".pod-docs-edit-body") as HTMLTextAreaElement)?.value).toBe(
      hostile,
    );
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
    await screen.findByText("hello body text", { selector: ".pod-docs-body" });
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

// ── WRITE flow (create + save-edit) end-to-end against the real DocsStore. ─────

const PRIVATE_INDEX = "https://alice.pod/settings/privateTypeIndex.ttl";

/**
 * A WRITE-aware fetch stub: serves the container + documents on GET, a WebID
 * pre-linked to a private Type Index ALREADY carrying the pod-docs registration
 * (so `DocsStore.create`'s `ensureRegistered` does no extra writes), and accepts
 * any PUT inside the container. `putStatus` lets a test fail the document write.
 */
function writeStub(opts: {
  documents?: Record<string, { body?: string; status?: number; etag?: string }>;
  containerChildren?: string[];
  putStatus?: number;
  onPut?: (url: string, body: string) => void;
}): typeof fetch {
  const documents = opts.documents ?? {};
  const indexBody = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
    <> a solid:TypeIndex .
    <#reg> a solid:TypeRegistration ; solid:forClass pd:Document ;
      solid:instanceContainer <${CONTAINER}> .
  `;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "PUT") {
      if (url.startsWith(CONTAINER) && url.endsWith(".ttl")) {
        opts.onPut?.(url, init?.body as string);
        const status = opts.putStatus ?? 201;
        if (status >= 400) return new Response("err", { status });
        return new Response(null, { status, headers: { etag: 'W/"new"' } });
      }
      return new Response(null, { status: 201 });
    }

    // GET routes.
    if (url === WEBID) {
      return new Response(
        `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${PRIVATE_INDEX}> .`,
        { status: 200, headers: { "content-type": "text/turtle", etag: 'W/"p"' } },
      );
    }
    if (url === PRIVATE_INDEX) {
      return new Response(indexBody, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: 'W/"i"' },
      });
    }
    if (url === CONTAINER) {
      return new Response(containerTtl(opts.containerChildren ?? []), {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }
    const doc = documents[url];
    if (doc) {
      if (doc.status && doc.status >= 400) return new Response("err", { status: doc.status });
      return new Response(doc.body ?? "", {
        status: 200,
        headers: { "content-type": "text/turtle", etag: doc.etag ?? 'W/"e"' },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("DocumentBrowser — creating a document", () => {
  it("expands the form, creates a document optimistically, shows Saved and opens it", async () => {
    const fetch = writeStub({ containerChildren: [] });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);

    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh Doc" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: /create document/i }));

    // Optimistic: a "Saving…" indicator appears immediately.
    expect(screen.getByText(/saving…/i)).toBeInTheDocument();
    // On persist, the new document opens (its body is shown in the <pre>) and
    // Saved is shown.
    expect(
      await screen.findByText("hello world", { selector: ".pod-docs-body" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Saved$/)).toBeInTheDocument();
  });

  it("reverts and shows an error when the create write fails", async () => {
    const fetch = writeStub({ containerChildren: [], putStatus: 500 });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);

    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByRole("button", { name: /create document/i }));

    // The failure surfaces and the optimistic row is reverted (back to empty).
    expect(await screen.findByRole("alert")).toHaveTextContent(/500|fail|write/i);
    expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
  });

  it("disables Create while the title and body are both blank", async () => {
    const fetch = writeStub({ containerChildren: [] });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    expect(screen.getByRole("button", { name: /create document/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: /create document/i })).toBeEnabled();
  });

  it("ignores a blank form submit (the guard mirrors the disabled button)", async () => {
    let puts = 0;
    const fetch = writeStub({ containerChildren: [], onPut: () => puts++ });
    const { container } = render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    // Submit the form directly while both fields are blank (bypassing the
    // disabled submit button) — the onSubmit guard must short-circuit, no I/O.
    const form = container.querySelector(".pod-docs-new-form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(puts).toBe(0);
    expect(screen.queryByText(/saving…/i)).not.toBeInTheDocument();
  });

  it("cancels the form without creating anything", async () => {
    const fetch = writeStub({ containerChildren: [] });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new document/i })).toBeInTheDocument();
  });

  it("surfaces a 403 on create as a permission error", async () => {
    const fetch = writeStub({ containerChildren: [], putStatus: 403 });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    await screen.findByText(/no documents yet/i);
    fireEvent.click(screen.getByRole("button", { name: /new document/i }));
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: /create document/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/i);
  });
});

describe("DocumentBrowser — saving an edit to an open document", () => {
  it("edits the body, saves optimistically and shows Saved", async () => {
    let putBody = "";
    const fetch = writeStub({
      containerChildren: [DOC],
      documents: { [DOC]: { body: docTtl({ title: "My notes", body: "original" }) } },
      onPut: (_url, body) => {
        putBody = body;
      },
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));

    const editor = await screen.findByLabelText("Body");
    fireEvent.change(editor, { target: { value: "revised text" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(await screen.findByText(/^Saved$/)).toBeInTheDocument();
    // The new body was serialised into the PUT (a new PROV revision).
    expect(putBody).toContain("revised text");
  });

  it("reverts the body and shows an error when the save write fails", async () => {
    const fetch = writeStub({
      containerChildren: [DOC],
      documents: { [DOC]: { body: docTtl({ title: "My notes", body: "original" }) } },
      putStatus: 409,
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));
    const editor = await screen.findByLabelText("Body");
    fireEvent.change(editor, { target: { value: "revised text" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/409|fail|write/i);
    // The persisted body (rendered in the <pre>) remains the original.
    expect(screen.getByText("original")).toBeInTheDocument();
  });

  it("ignores a clean (un-edited) save submit (the guard mirrors the disabled button)", async () => {
    let puts = 0;
    const fetch = writeStub({
      containerChildren: [DOC],
      documents: { [DOC]: { body: docTtl({ title: "My notes", body: "original" }) } },
      onPut: () => puts++,
    });
    const { container } = render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));
    await screen.findByLabelText("Body");
    // Submit the edit form without changing the body (bypassing the disabled
    // Save button) — the not-dirty guard must short-circuit, no PUT.
    const form = container.querySelector(".pod-docs-edit-form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(puts).toBe(0);
  });

  it("disables Save until the body is edited (dirty tracking)", async () => {
    const fetch = writeStub({
      containerChildren: [DOC],
      documents: { [DOC]: { body: docTtl({ title: "My notes", body: "original" }) } },
    });
    render(<DocumentBrowser podRoot={POD} webId={WEBID} fetch={fetch} />);
    fireEvent.click(await screen.findByRole("button", { name: /My notes/i }));
    await screen.findByLabelText("Body");
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "changed" } });
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeEnabled();
  });
});
