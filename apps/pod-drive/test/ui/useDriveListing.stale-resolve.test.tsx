// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 5.5
//
// listContainer (via fetch-rdf) rejects once its signal aborts, so the hook's
// resolve-side staleness guard is only reachable if a listing resolves anyway.
// Pin that guard with a listContainer that ignores its signal.

import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const pending = new Map<string, (value: unknown) => void>();
vi.mock("../../src/drive.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/drive.js")>();
  return {
    ...actual,
    listContainer: (url: string) =>
      new Promise((resolve) => {
        pending.set(url, resolve);
      }),
  };
});

const { useDriveListing } = await import("../../src/ui/useDriveListing.js");

const listing = (url: string) => ({ url, container: { entries: [] } });

it("ignores a superseded listing that resolves despite the abort", async () => {
  const { result } = renderHook(() => useDriveListing("https://pod.example/slow/"));
  act(() => result.current.navigate("https://pod.example/fast/"));
  await waitFor(() => expect(pending.has("https://pod.example/fast/")).toBe(true));
  await act(async () =>
    pending.get("https://pod.example/fast/")?.(listing("https://pod.example/fast/")),
  );
  await waitFor(() => expect(result.current.listing?.url).toBe("https://pod.example/fast/"));
  await act(async () =>
    pending.get("https://pod.example/slow/")?.(listing("https://pod.example/slow/")),
  );
  expect(result.current.listing?.url).toBe("https://pod.example/fast/");
  expect(result.current.loading).toBe(false);
});
