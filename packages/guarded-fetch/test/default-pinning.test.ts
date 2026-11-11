// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({
  resolve: vi.fn(),
  reached: [] as string[],
  dispatchers: [] as unknown[],
  closes: vi.fn(),
  response: vi.fn(),
  onSend: vi.fn(),
  lookupHost: undefined as string | undefined,
  all: true,
  skipLookup: false,
}));

vi.mock("node:dns/promises", () => ({ lookup: network.resolve }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(readonly options: { connect: { lookup: (...args: unknown[]) => void } }) {}
    close = network.closes;
  },
  fetch: socketFetch,
  getGlobalDispatcher: () => undefined,
  FormData: globalThis.FormData,
}));

import { createGuardedFetch, guardedFetch, SsrfError } from "../src/index.js";

// Model the transport's DNS boundary: without a pinned dispatcher, connecting resolves
// again. With one, invoke the actual lookup installed by the guard, as net.connect does.
async function socketFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  network.onSend();
  const hostname = new URL(String(input)).hostname;
  const dispatcher = (init as RequestInit & { dispatcher?: unknown })?.dispatcher as
    | { options: { connect: { lookup: (...args: unknown[]) => void } } }
    | undefined;
  network.dispatchers.push(dispatcher);
  if (network.skipLookup) return new Response("ignored pin");
  const addresses = dispatcher
    ? await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        dispatcher.options.connect.lookup(
          network.lookupHost ?? hostname,
          { all: network.all },
          (
            error: Error | null,
            records: string | Array<{ address: string; family: number }>,
            family: number,
          ) =>
            error
              ? reject(error)
              : resolve(typeof records === "string" ? [{ address: records, family }] : records),
        );
      })
    : await network.resolve(hostname, { all: true });
  network.reached.push(...addresses.map((record: { address: string }) => record.address));
  return network.response() ?? new Response("ok");
}

beforeEach(() => {
  network.resolve.mockReset();
  network.resolve
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
    .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
  network.reached.length = 0;
  network.dispatchers.length = 0;
  network.closes.mockReset().mockResolvedValue(undefined);
  network.response.mockReset();
  network.onSend.mockReset();
  network.lookupHost = undefined;
  network.all = true;
  network.skipLookup = false;
  vi.stubGlobal("fetch", socketFetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("Node hostname pinning defaults", () => {
  it.each([
    () => createGuardedFetch(),
    () => guardedFetch,
  ])("pins the default transport: a public-then-private resolver cannot reach private addresses (%#)", async (factory) => {
    const fetch = factory();
    expect(await (await fetch("https://registry.example/catalog")).text()).toBe("ok");
    expect(network.reached).toEqual(["93.184.216.34"]);
    expect(network.resolve).toHaveBeenCalledOnce();
    expect(network.closes).toHaveBeenCalledOnce();
  });

  it("fails closed for an unattested custom fetch before querying DNS", async () => {
    const fetch = vi.fn(socketFetch);
    await expect(createGuardedFetch({ fetch })("https://registry.example/")).rejects.toThrow(
      /requireDnsPinning/,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(network.resolve).not.toHaveBeenCalled();
  });

  it("allowUnresolvedHosts does not opt a Node custom transport out of pinning", async () => {
    const fetch = vi.fn(socketFetch);
    await expect(
      createGuardedFetch({ fetch, allowUnresolvedHosts: true })("https://registry.example/"),
    ).rejects.toThrow(/requireDnsPinning/);
    expect(fetch).not.toHaveBeenCalled();
    expect(network.resolve).not.toHaveBeenCalled();
  });

  it("forcing DNS-less mode on Node cannot silently bypass the default pinning requirement", async () => {
    const fetch = vi.fn(socketFetch);
    await expect(
      createGuardedFetch({ fetch, dnsLookup: null, allowUnresolvedHosts: true })(
        "https://registry.example/",
      ),
    ).rejects.toThrow(/requireDnsPinning/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("also supplies the built-in pin when requireDnsPinning is explicitly true", async () => {
    await createGuardedFetch({ requireDnsPinning: true })("https://registry.example/");
    expect(network.reached).toEqual(["93.184.216.34"]);
    expect(network.resolve).toHaveBeenCalledOnce();
  });

  it("keeps concurrent requests' DNS pins separate", async () => {
    network.resolve.mockReset();
    network.resolve
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    const fetch = createGuardedFetch();
    await Promise.all([fetch("https://registry.example/a"), fetch("https://registry.example/b")]);
    expect(network.reached.sort()).toEqual(["1.1.1.1", "93.184.216.34"]);
    expect(network.resolve).toHaveBeenCalledTimes(2);
    expect(network.dispatchers[0]).not.toBe(network.dispatchers[1]);
  });

  it("prepares the lazy transport before the synchronous authority fence", async () => {
    let authorised = false;
    network.onSend.mockImplementation(() => expect(authorised).toBe(true));
    await createGuardedFetch({
      beforeDispatch: () => {
        authorised = true;
        queueMicrotask(() => {
          authorised = false;
        });
      },
    })("https://registry.example/");
    expect(network.onSend).toHaveBeenCalledOnce();
  });

  it("snapshots validated records before a caller can mutate the resolver's array", async () => {
    const records = [{ address: "93.184.216.34", family: 4 }];
    network.resolve.mockReset().mockResolvedValue(records);
    await createGuardedFetch({
      beforeDispatch: () => {
        records[0] = { address: "10.0.0.7", family: 4 };
      },
    })("https://registry.example/");
    expect(network.reached).toEqual(["93.184.216.34"]);
  });

  it("never dispatches or constructs an agent when the authority fence refuses", async () => {
    const refusal = new Error("authority revoked");
    await expect(
      createGuardedFetch({
        beforeDispatch: () => {
          throw refusal;
        },
      })("https://registry.example/"),
    ).rejects.toBe(refusal);
    expect(network.onSend).not.toHaveBeenCalled();
    expect(network.closes).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    socketFetch,
  ])("requireDnsPinning: false explicitly restores the separate-lookup posture (%#)", async (fetch) => {
    await createGuardedFetch({ fetch, requireDnsPinning: false })("https://registry.example/");
    expect(network.reached).toEqual(["10.0.0.7"]);
    expect(network.resolve).toHaveBeenCalledTimes(2);
    expect(network.dispatchers).toEqual([undefined]);
  });

  it("pins afresh after each redirect and overrides a caller-supplied dispatcher", async () => {
    network.resolve.mockReset();
    network.resolve
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
      .mockResolvedValue([{ address: "10.0.0.7", family: 4 }]);
    network.response.mockReturnValueOnce(
      new Response(null, { status: 302, headers: { location: "https://other.example/" } }),
    );
    const untrusted = {};
    await createGuardedFetch()("https://registry.example/", {
      dispatcher: untrusted,
    } as RequestInit);
    expect(network.reached).toEqual(["93.184.216.34", "1.1.1.1"]);
    expect(network.resolve).toHaveBeenCalledTimes(2);
    expect(network.dispatchers).not.toContain(untrusted);
    expect(network.closes).toHaveBeenCalledTimes(2);
  });

  it("retains the branded pinningFetch seam without imposing a dispatcher", async () => {
    const pinningFetch = vi.fn(async () => new Response("pinned by caller"));
    await createGuardedFetch({ pinningFetch })("https://registry.example/");
    expect(pinningFetch).toHaveBeenCalledOnce();
    expect(network.dispatchers).toEqual([]);
  });

  it("continues to reject mixed public/private answers before connecting", async () => {
    network.resolve.mockReset().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ]);
    await expect(createGuardedFetch()("https://registry.example/")).rejects.toBeInstanceOf(
      SsrfError,
    );
    expect(network.reached).toEqual([]);
  });
});

it("refuses a hostname response if the transport never invoked its pinned lookup", async () => {
  network.skipLookup = true;
  await expect(createGuardedFetch()("https://registry.example/")).rejects.toThrow(/lookup/);
  expect(network.closes).toHaveBeenCalledOnce();
});

it("refuses an unexpected connection hostname and closes the Agent", async () => {
  network.lookupHost = "other.example";
  await expect(createGuardedFetch()("https://registry.example/")).rejects.toThrow(
    /unexpected connection hostname/,
  );
  expect(network.reached).toEqual([]);
  expect(network.closes).toHaveBeenCalledOnce();
});

it("returns the single-address callback when all is false", async () => {
  network.all = false;
  await createGuardedFetch()("https://registry.example/");
  expect(network.reached).toEqual(["93.184.216.34"]);
});

it("closes the Agent when the transport rejects", async () => {
  network.onSend.mockImplementation(() => {
    throw new Error("transport rejected");
  });
  await expect(createGuardedFetch()("https://registry.example/")).rejects.toThrow(
    /transport rejected/,
  );
  expect(network.closes).toHaveBeenCalledOnce();
});
