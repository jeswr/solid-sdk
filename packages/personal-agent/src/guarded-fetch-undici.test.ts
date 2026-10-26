/**
 * Compatibility pin for the scoped `overrides["@jeswr/guarded-fetch"].undici` (8.9.0, the
 * first release outside the advisories affecting 8.0.0–8.8.0): guarded-fetch's Node entry
 * uses undici's `Agent`, `buildConnector` and `fetch`. Exercised against a LOCAL server on
 * 127.0.0.1 only — no external network. The redirect target below is never contacted: the
 * guard must refuse it before any connection.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect-local") {
      res.writeHead(302, { location: "/ok" }).end();
      return;
    }
    if (req.url === "/redirect-metadata") {
      // A link-local metadata address: must be refused by the guard, never dialled.
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The undici version guarded-fetch actually loads. */
function undiciSeenByGuardedFetch(): string {
  // Resolve `undici` from guarded-fetch's own module file, as Node does for its import.
  const guarded = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules/@jeswr/guarded-fetch/dist/node.js",
  );
  let dir = dirname(createRequire(guarded).resolve("undici"));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "undici") return pkg.version;
    } catch {
      // keep walking up
    }
    const up = dirname(dir);
    if (up === dir) throw new Error("undici package.json not found");
    dir = up;
  }
}

describe("guarded-fetch on the overridden undici", () => {
  it("loads the pinned patched undici release", () => {
    expect(undiciSeenByGuardedFetch()).toBe("8.9.0");
  });

  it("performs a pinned request through Agent/buildConnector/fetch under the loopback hatch", async () => {
    const res = await createNodeGuardedFetch({ allowLoopback: true })(`${base}/ok`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("refuses loopback without the hatch", async () => {
    await expect(createNodeGuardedFetch()(`${base}/ok`)).rejects.toThrow(/allowLoopback|refused/i);
  });

  it("re-validates each redirect hop: a local hop is followed, a metadata-address hop is refused", async () => {
    const fetch = createNodeGuardedFetch({ allowLoopback: true });
    const followed = await fetch(`${base}/redirect-local`);
    expect([followed.status, followed.url]).toEqual([200, `${base}/ok`]);
    const started = Date.now();
    await expect(fetch(`${base}/redirect-metadata`)).rejects.toThrow(
      /non-public|loopback|refused|not (allowed|permitted)/i,
    );
    expect(Date.now() - started).toBeLessThan(2_000); // refused, not a dial attempt timing out
  });
});
