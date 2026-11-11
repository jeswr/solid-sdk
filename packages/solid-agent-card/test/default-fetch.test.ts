// AUTHORED-BY Claude Opus 5.5
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverAgent, verifyDescriptor } from "../src/index.js";

// A private target a hostile profile might name. The default fetch must never reach it.
describe("default fetch is the SSRF boundary", () => {
  let server: Server;
  let base: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      hits.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/turtle" });
      response.end(
        `<#me> <http://www.w3.org/ns/solid/interop#hasAuthorizationAgent> <${base}/agent#it> .`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("refuses a loopback WebID without sending a request", async () => {
    expect(await discoverAgent(`${base}/profile#me`)).toEqual({
      webId: `${base}/profile#me`,
      pointers: [],
    });
    expect(hits).toEqual([]);
  });

  it("refuses a loopback descriptor URL without sending a request", async () => {
    const result = await verifyDescriptor(`${base}/agent`);
    expect(result.valid).toBe(false);
    expect(result.issues).not.toHaveLength(0);
    expect(hits).toEqual([]);
  });

  it("still uses an injected fetch in place of the default", async () => {
    const result = await discoverAgent(`${base}/profile#me`, {
      fetch: globalThis.fetch,
      resolveDescriptor: false,
    });
    expect(result.pointers.map((pointer) => pointer.agent)).toEqual([`${base}/agent#it`]);
    expect(hits).toEqual(["/profile"]);
  });
});
