// AUTHORED-BY Codex GPT-6.1-Sol
import { Store } from "n3";
import { describe, expect, test } from "vitest";
import { ContactsTransport, replacement } from "../src/apps/contacts/lib/model/transport";
import { ALICE, MemoryPod, ROOT } from "./contacts-support";

describe("contacts injected transport", () => {
  test("requires preconditions on deletion and rejects malformed ETags before writes", async () => {
    const pod = new MemoryPod();
    const transport = new ContactsTransport(ROOT, pod.fetch);
    await expect(transport.commit([{ url: ALICE, etag: null }])).rejects.toThrow(
      "Deletion requires",
    );
    for (const etag of ["*", 'W/"weak"', "", '"injected"\r\nHeader: x']) {
      await expect(transport.commit([{ url: ALICE, dataset: new Store(), etag }])).rejects.toThrow(
        "strong ETag",
      );
    }
    expect(pod.requests).toHaveLength(0);
    expect(() => replacement({ url: ALICE, etag: null, data: null, dataset: new Store() })).toThrow(
      "strong ETag",
    );
  });

  test("preflights all URLs before the first write and refuses authenticated redirect hops", async () => {
    const pod = new MemoryPod();
    const transport = new ContactsTransport(ROOT, pod.fetch);
    await expect(
      transport.commit([
        { url: ALICE, dataset: new Store(), etag: null },
        { url: "https://evil.example/x", dataset: new Store(), etag: null },
      ]),
    ).rejects.toThrow();
    expect(pod.requests).toHaveLength(0);
    pod.fail = () => new Response(null, { status: 303, headers: { location: `${ROOT}elsewhere` } });
    await expect(
      transport.commit([{ url: ALICE, dataset: new Store(), etag: null }]),
    ).rejects.toThrow("redirect");
    expect(pod.requests).toHaveLength(1);
  });

  test("retains absent response ETags and propagates network failures and partial writes", async () => {
    let calls = 0;
    const transport = new ContactsTransport(ROOT, async () => {
      calls++;
      return new Response(null, { status: 204 });
    });
    expect(await transport.commit([{ url: ALICE, dataset: new Store(), etag: null }])).toEqual([
      null,
    ]);
    expect(calls).toBe(1);
    const network = new ContactsTransport(ROOT, async () => {
      throw new Error("offline");
    });
    await expect(
      network.commit([{ url: ALICE, dataset: new Store(), etag: null }]),
    ).rejects.toThrow("offline");
    expect(await transport.commit([])).toEqual([]);
  });
});
