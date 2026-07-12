// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The health-records VIEW + its data hook, driven by a stubbed authenticated
// fetch (the auth seam). Proves the view renders a real health resource (parsed
// by the data layer) as a chronological typed-field list, and renders the empty
// / loading / error / access-denied states — all with NO real pod and NO login
// flow. Health content is never logged.

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRecords } from "../../src/ui/index.js";
import { CONFORMANT_HEALTH_TTL } from "../fixtures.js";

const RESOURCE = "https://carol.example/health/record.ttl";

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fake authenticated fetch returning a canned Turtle body for the resource. */
function turtleFetch(ttl: string): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = new Response(ttl, {
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

describe("HealthRecords", () => {
  it("renders the records list with typed fields — type, date and value/unit", async () => {
    render(
      <HealthRecords
        resourceUrl={RESOURCE}
        fetch={turtleFetch(CONFORMANT_HEALTH_TTL)}
        title="My Health"
      />,
    );

    expect(screen.getByRole("heading", { name: "My Health" })).toBeInTheDocument();

    // The heart-rate observation row shows its type, resolved date and value+unit.
    const obsRow = (await screen.findByText("Heart Rate")).closest("tr");
    expect(obsRow).not.toBeNull();
    expect(obsRow).toHaveTextContent("2026-06-13");
    expect(obsRow).toHaveTextContent("72 /min");

    // The condition row renders (dateless, valueless → dashes).
    expect(screen.getByText("Condition")).toBeInTheDocument();
    // The record itself renders.
    expect(screen.getByText("Health Record")).toBeInTheDocument();

    // Newest-first: the dated observation precedes the dateless rows.
    const rows = screen.getAllByRole("row");
    // rows[0] = header; rows[1] = the dated observation (Heart Rate).
    expect(rows[1]).toHaveTextContent("Heart Rate");
  });

  it("shows the empty state for a document with no health entries", async () => {
    const EMPTY = `@prefix core: <https://TBD.example/solid/core#> .
<https://carol.example/health/record.ttl> a core:Person .`;
    render(<HealthRecords resourceUrl={RESOURCE} fetch={turtleFetch(EMPTY)} />);
    expect(await screen.findByText("No health records found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a login-flavoured access error (401) with NO retry button", async () => {
    render(<HealthRecords resourceUrl={RESOURCE} fetch={statusFetch(401)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("You need to log in");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a permission access error (403) with NO retry button", async () => {
    render(<HealthRecords resourceUrl={RESOURCE} fetch={statusFetch(403)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("don't have permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a generic error (404) WITH a working retry that re-fetches", async () => {
    let present = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!present) {
        const res = new Response(null, { status: 404 });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }
      const res = new Response(CONFORMANT_HEALTH_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<HealthRecords resourceUrl={RESOURCE} fetch={fetch} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    present = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByText("Heart Rate")).toBeInTheDocument();
  });

  it("shows a loading status while the first request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: string | URL | Request) => {
      await gate;
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(CONFORMANT_HEALTH_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof globalThis.fetch;

    render(<HealthRecords resourceUrl={RESOURCE} fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(await screen.findByText("Heart Rate")).toBeInTheDocument();
  });

  it("falls back to the global fetch when no fetch prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const res = new Response(CONFORMANT_HEALTH_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch);
    render(<HealthRecords resourceUrl={RESOURCE} />);
    expect(await screen.findByText("Heart Rate")).toBeInTheDocument();
  });

  it("renders without a title heading when none is given", async () => {
    render(<HealthRecords resourceUrl={RESOURCE} fetch={turtleFetch(CONFORMANT_HEALTH_TTL)} />);
    await screen.findByText("Heart Rate");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
