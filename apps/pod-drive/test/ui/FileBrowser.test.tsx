// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The file-browser VIEW + its data hook, driven by a stubbed authenticated
// fetch (the auth seam). Proves the view renders a real LDP container listing
// (parsed by the data layer), navigates into sub-containers and back via the
// breadcrumb, and renders the empty / loading / error / access-denied states —
// all with NO real pod and NO login flow.

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBrowser } from "../../src/ui/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// A tiny LDP "pod": maps a container URL to the Turtle a GET returns. Anything
// not in the map 404s. `withMeta` adds posix:size + dcterms:modified so the
// size/modified columns are exercised.
const ROOT = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix posix: <http://www.w3.org/ns/posix/stat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<https://pod.example/drive/> a ldp:Container ;
  ldp:contains <https://pod.example/drive/photos/>, <https://pod.example/drive/notes.txt> .
<https://pod.example/drive/photos/> a ldp:Container .
<https://pod.example/drive/notes.txt> a ldp:Resource ;
  posix:size 2048 ;
  dcterms:format "text/plain" ;
  dcterms:modified "2026-06-15T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
`;

const PHOTOS = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/drive/photos/> a ldp:Container ;
  ldp:contains <https://pod.example/drive/photos/cat.png> .
<https://pod.example/drive/photos/cat.png> a ldp:Resource .
`;

const EMPTY = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<https://pod.example/drive/photos/> a ldp:Container .
`;

/** A fake authenticated fetch that routes by URL to a canned Turtle body. */
function routerFetch(map: Record<string, string>): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = map[url];
    if (body === undefined) {
      const res = new Response(null, { status: 404 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "text/turtle", etag: '"v1"' },
    });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

/** A fake fetch that always returns the given status (for 401/403/404 paths). */
function statusFetch(status: number): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = new Response(null, { status });
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as unknown as typeof globalThis.fetch;
}

describe("FileBrowser", () => {
  it("renders the container listing — folders first, then files, with kind/size/modified", async () => {
    const fetch = routerFetch({ "https://pod.example/drive/": ROOT });
    render(<FileBrowser rootUrl="https://pod.example/drive/" fetch={fetch} title="My Drive" />);

    expect(screen.getByRole("heading", { name: "My Drive" })).toBeInTheDocument();

    // Folder appears as a button (navigable); file as a link.
    const folderBtn = await screen.findByRole("button", { name: /photos/ });
    expect(folderBtn).toBeInTheDocument();
    const fileLink = screen.getByRole("link", { name: /notes\.txt/ });
    expect(fileLink).toHaveAttribute("href", "https://pod.example/drive/notes.txt");
    expect(fileLink).toHaveAttribute("rel", "noopener noreferrer");

    // Folder-first ordering: photos (folder) before notes.txt (file).
    const rowCells = screen.getAllByRole("row");
    // rows[0] is the header; rows[1] the folder; rows[2] the file.
    expect(rowCells[1]).toHaveTextContent("photos");
    expect(rowCells[1]).toHaveTextContent("Folder");
    expect(rowCells[2]).toHaveTextContent("notes.txt");
    expect(rowCells[2]).toHaveTextContent("text/plain");
    expect(rowCells[2]).toHaveTextContent("2 KB");
    expect(rowCells[2]).toHaveTextContent("2026-06-15");
  });

  it("navigates into a sub-container and back via the breadcrumb", async () => {
    const fetch = routerFetch({
      "https://pod.example/drive/": ROOT,
      "https://pod.example/drive/photos/": PHOTOS,
    });
    render(<FileBrowser rootUrl="https://pod.example/drive/" fetch={fetch} />);

    const folderBtn = await screen.findByRole("button", { name: /photos/ });
    await act(async () => {
      folderBtn.click();
    });

    // Now inside photos/: cat.png is shown, notes.txt is gone.
    expect(await screen.findByRole("link", { name: /cat\.png/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /notes\.txt/ })).not.toBeInTheDocument();

    // Breadcrumb shows Drive > photos; click Drive to climb back.
    const driveCrumb = screen.getByRole("button", { name: "Drive" });
    await act(async () => {
      driveCrumb.click();
    });
    expect(await screen.findByRole("link", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("shows the empty state for a container with no children", async () => {
    const fetch = routerFetch({ "https://pod.example/drive/photos/": EMPTY });
    render(<FileBrowser rootUrl="https://pod.example/drive/photos/" fetch={fetch} />);
    expect(await screen.findByText("This folder is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a login-flavoured access error (401) with NO retry button", async () => {
    const fetch = statusFetch(401);
    render(<FileBrowser rootUrl="https://pod.example/private/" fetch={fetch} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You need to log in");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a permission access error (403) with NO retry button", async () => {
    const fetch = statusFetch(403);
    render(<FileBrowser rootUrl="https://pod.example/private/" fetch={fetch} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("don't have permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a generic error (404) WITH a working retry that re-fetches", async () => {
    // First load 404s; after the user retries, the container is present.
    let present = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!present) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }
      const res = new Response(ROOT, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<FileBrowser rootUrl="https://pod.example/drive/" fetch={fetch} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    present = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByRole("link", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("shows a loading status while the first request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: string | URL | Request) => {
      await gate;
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(ROOT, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<FileBrowser rootUrl="https://pod.example/drive/" fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(await screen.findByRole("link", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("falls back to the global fetch when no fetch prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(ROOT, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch);
    render(<FileBrowser rootUrl="https://pod.example/drive/" />);
    expect(await screen.findByRole("link", { name: /notes\.txt/ })).toBeInTheDocument();
  });

  it("renders without a title heading when none is given", async () => {
    const fetch = routerFetch({ "https://pod.example/drive/": ROOT });
    render(<FileBrowser rootUrl="https://pod.example/drive/" fetch={fetch} />);
    await screen.findByRole("link", { name: /notes\.txt/ });
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
