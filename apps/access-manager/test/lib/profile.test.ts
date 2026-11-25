// AUTHORED-BY Codex GPT-6.1-Sol
import { FOAF, MAX_NOTIFICATION_BYTES } from "@jeswr/pod-access/requests-solid";
import { LiteralFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAgentDisplayCache, resolveAgentDisplay } from "../../src/lib/profile.js";
import { toTurtle } from "../../src/lib/rdf.js";

const AGENT = "https://app.example/profile#me";
const OWNER = "https://owner.example/profile#me";

afterEach(() => vi.useRealTimers());

async function profile(name: string) {
  const dataset = new Store();
  OptionalAs.object(
    new TermWrapper(AGENT, dataset, DataFactory),
    FOAF.name,
    name,
    LiteralFrom.string,
  );
  return new Response(await toTurtle(dataset), { headers: { "content-type": "text/turtle" } });
}

describe("public display profiles", () => {
  it("aborts a stalled lookup after 10 s, drops it from the cache and retries", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(await profile("After timeout"));
    const lookup = resolveAgentDisplay(AGENT, fetchFn, OWNER);
    const signal = fetchFn.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect((await lookup).resolved).toBe(false);
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("After timeout");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts on cancellation and keeps a replacement lookup cached after the old one settles", async () => {
    vi.useFakeTimers();
    let finishFirst: (response: Response) => void = () => {};
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(await profile("Replacement"));
    const controller = new AbortController();
    const first = resolveAgentDisplay(AGENT, fetchFn, OWNER, controller.signal);
    controller.abort();
    const replacement = resolveAgentDisplay(AGENT, fetchFn, OWNER);
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect((await first).resolved).toBe(false);
    expect((await replacement).name).toBe("Replacement");
    finishFirst(await profile("Abandoned"));
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("Replacement");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares a pending lookup and aborts only when its last reader leaves", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const first = new AbortController();
    const second = new AbortController();
    const one = resolveAgentDisplay(AGENT, fetchFn, OWNER, first.signal);
    const two = resolveAgentDisplay(AGENT, fetchFn, OWNER, second.signal);
    expect(fetchFn).toHaveBeenCalledOnce();
    first.abort();
    expect((await one).resolved).toBe(false);
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    second.abort();
    expect((await two).resolved).toBe(false);
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start an already-aborted lookup or retain a deadline after success", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(await profile("Cached"));
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER, controller.signal)).resolved).toBe(
      false,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("Cached");
    const signal = fetchFn.mock.calls[0]?.[1]?.signal;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal?.aborted).toBe(false);
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("Cached");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([
    "http://public.example/profile#me",
    "http://192.168.1.1/profile#me",
    "http://localhost:8080/profile#me",
    "https://localhost/profile#me",
    "https://127.0.0.1/profile#me",
    "https://[::1]/profile#me",
    "https://192.168.1.1/profile#me",
    "https://169.254.169.254/profile#me",
    "https://router.local/profile#me",
    "https://user:secret@public.example/profile#me",
  ])("never fetches rejected requester %s", async (webId) => {
    const fetchFn = vi.fn();
    expect(await resolveAgentDisplay(webId, fetchFn, OWNER)).toEqual({
      webId,
      name: webId,
      resolved: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("bounds streamed hostile bodies, cancels the stream and retries a failed lookup", async () => {
    const cancel = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_NOTIFICATION_BYTES + 1));
            },
            cancel,
          }),
          { headers: { "content-type": "text/turtle" } },
        ),
      )
      .mockResolvedValueOnce(await profile("Reader"));
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).resolved).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("Reader");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", redirect: "error" });
  });

  it("refuses redirects and does not cache network, missing or malformed-profile failures", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://localhost/" } }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response("not RDF", { headers: { "content-type": "text/turtle" } }),
      )
      .mockResolvedValueOnce(await profile("Recovered"));
    for (let i = 0; i < 4; i++)
      expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).resolved).toBe(false);
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("Recovered");
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("scopes cached names to the session WebID even when the fetch object is unchanged", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(await profile("First account"))
      .mockResolvedValueOnce(await profile("Second account"))
      .mockResolvedValueOnce(await profile("After logout"));
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("First account");
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("First account");
    expect((await resolveAgentDisplay(AGENT, fetchFn, "https://other.example/#me")).name).toBe(
      "Second account",
    );
    clearAgentDisplayCache();
    expect((await resolveAgentDisplay(AGENT, fetchFn, OWNER)).name).toBe("After logout");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
