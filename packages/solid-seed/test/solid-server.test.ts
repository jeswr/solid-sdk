// AUTHORED-BY GPT-5.6 Sol via codex

import { createServer, type Server } from "node:net";
import { startSolidServer } from "@jeswr/solid-server";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountProvisioner, SeedTarget } from "../src/index.js";
import { seedPods } from "../src/index.js";

declare module "@jeswr/solid-server" {
  interface SolidHttpServer {
    closeAllConnections(): void;
  }
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("port probe failed");
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  if ("closeAllConnections" in server && typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

class SparqProvisioner implements AccountProvisioner {
  readonly targets: SeedTarget[] = [];
  readonly servers: Server[] = [];

  async provisionAccount(webid?: string): Promise<SeedTarget> {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const ownerWebid = webid ?? `${baseUrl}/profile/card#me`;
    const server = await startSolidServer({ port, baseUrl, ownerWebid });
    this.servers.push(server);
    const target = { webid: ownerWebid, baseUrl, authFetch: fetch };
    this.targets.push(target);
    return target;
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled(this.servers.map((server) => closeServer(server)));
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "failed to close sparq integration servers",
      );
    }
  }
}

describe("@jeswr/solid-server integration", () => {
  const provisioners: SparqProvisioner[] = [];

  afterEach(async () => {
    await Promise.all(provisioners.splice(0).map((provisioner) => provisioner.close()));
  });

  it("provisions multiple pods and writes nested resources with negotiated media types", async () => {
    const provisioner = new SparqProvisioner();
    provisioners.push(provisioner);
    const manifest = await seedPods({
      provisioner,
      layout: {
        pods: [
          {
            account: { provision: {} },
            resources: [
              {
                path: "/mortgage/applications/current",
                source: {
                  body: '<#it> <https://schema.org/name> "Application" .\n',
                },
              },
            ],
          },
          {
            account: { provision: { webid: "https://id.example/lender#me" } },
            resources: [
              {
                path: "/mortgage/credentials/income",
                source: {
                  body: JSON.stringify({
                    "@id": "#it",
                    "@type": "https://www.w3.org/2018/credentials#VerifiableCredential",
                  }),
                },
                contentType: "application/ld+json",
              },
            ],
          },
        ],
      },
    });

    expect(manifest.pods).toHaveLength(2);
    expect(manifest.pods.flatMap((pod) => pod.resources.map((value) => value.status))).toEqual([
      "created",
      "created",
    ]);

    const turtle = await fetch(`${provisioner.targets[0]?.baseUrl}/mortgage/applications/current`);
    const jsonLd = await fetch(`${provisioner.targets[1]?.baseUrl}/mortgage/credentials/income`);
    expect(turtle.status).toBe(200);
    expect(turtle.headers.get("content-type")).toContain("text/turtle");
    expect(await turtle.text()).toContain("Application");
    expect(jsonLd.status).toBe(200);
    expect(jsonLd.headers.get("content-type")).toContain("application/ld+json");
    expect(await jsonLd.text()).toContain("VerifiableCredential");
  });
});
