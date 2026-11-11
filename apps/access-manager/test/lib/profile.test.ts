// AUTHORED-BY Codex GPT-6.1-Sol
import { FOAF, MAX_NOTIFICATION_BYTES } from "@jeswr/pod-access/requests-solid";
import { LiteralFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { clearAgentDisplayCache, resolveAgentDisplay } from "../../src/lib/profile.js";
import { toTurtle } from "../../src/lib/rdf.js";

const AGENT = "https://app.example/profile#me";
const OWNER = "https://owner.example/profile#me";

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
