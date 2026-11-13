// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { LDP, PIM, SOLID } from "@jeswr/pod-access/requests-solid";
import { NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toTurtle } from "../../src/lib/rdf.js";
import { useAccessData } from "../../src/ui/useAccessData.js";
import { buildPod, INBOX, OWNER, POD } from "../fixtures.js";

afterEach(() => vi.useRealTimers());

describe("owner profile discovery", () => {
  it.each([
    OWNER,
    "https://identity.example/profile#me",
  ])("reads %s publicly for storage, inbox and type-index discovery", async (webId) => {
    const pod = buildPod();
    const dataset = new Store();
    const agent = new TermWrapper(webId, dataset, DataFactory);
    for (const [predicate, value] of [
      [PIM.storage, POD],
      [LDP.inbox, INBOX],
      [SOLID.publicTypeIndex, `${POD}settings/publicTypeIndex.ttl`],
    ] as const) {
      OptionalAs.object(agent, predicate, value, NamedNodeFrom.string);
    }
    const turtle = await toTurtle(dataset);
    const publicFetch = vi.fn<typeof fetch>(
      async () => new Response(turtle, { headers: { "content-type": "text/turtle" } }),
    );
    const sessionFetch = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).not.toBe(webId);
      return pod.fetch(input, init);
    });
    const session = { webId, fetch: sessionFetch, publicFetch };
    const { result } = renderHook(() => useAccessData(session));
    await waitFor(() => {
      expect(result.current.storageRoot).toBe(POD);
      expect(result.current.inboxUrl).toBe(INBOX);
      expect(result.current.registrations).toHaveLength(1);
      expect(result.current.walking).toBe(false);
    });
    expect(publicFetch).toHaveBeenCalledTimes(3);
    for (const [url, init] of publicFetch.mock.calls) {
      expect(url).toBe(webId);
      expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(sessionFetch).toHaveBeenCalled();
  });

  it.each(["unmount", "timeout"])("aborts owner profile reads on %s", async (reason) => {
    vi.useFakeTimers();
    const publicFetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const session = { webId: OWNER, fetch: vi.fn(), publicFetch };
    const { result, unmount } = renderHook(() => useAccessData(session));
    expect(publicFetch).toHaveBeenCalledTimes(2);
    const signals = publicFetch.mock.calls.map(([, init]) => init?.signal);
    expect(signals.every((signal) => signal && !signal.aborted)).toBe(true);
    if (reason === "unmount") await act(async () => unmount());
    else {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current.storageRoot).toBeNull();
    }
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    expect(session.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
