// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseRdf } from "@jeswr/fetch-rdf";
import { forClientCredentials, type PodAuth } from "@jeswr/pod-auth/node";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import type { AppRunnerInput } from "@solid/community-server";
import { recordingSession } from "../recording.js";
import type { ConformanceTarget } from "../types.js";

/** Components.js otherwise scans ancestor node_modules and mixes CSS 7/8 in this workspace. */
async function moduleState(): Promise<
  NonNullable<NonNullable<AppRunnerInput["loaderProperties"]>["moduleState"]>
> {
  const require = createRequire(import.meta.url);
  const cssPackage = require.resolve("@solid/community-server/package.json");
  const cssPath = dirname(cssPackage);
  // Use the pinned server's own loader and dependency graph, with no ancestor traversal.
  const { ModuleStateBuilder } = createRequire(cssPackage)("componentsjs");
  const builder = new ModuleStateBuilder();
  const roots = new Set<string>([cssPath]);
  let nodeModulePaths: string[] = [];
  for (;;) {
    const count = roots.size;
    for (const path of [...roots]) {
      const virtual = /^(.*\/node_modules\/\.pnpm\/[^/]+)\/node_modules\//.exec(path);
      if (virtual?.[1]) roots.add(virtual[1]);
    }
    nodeModulePaths = await builder.buildNodeModulePaths([...roots]);
    for (const path of nodeModulePaths) roots.add(path);
    if (roots.size === count) break;
  }
  const nodeModuleImportPaths = [...roots];
  const packageJsons = await builder.buildPackageJsons(nodeModulePaths);
  await builder.preprocessPackageJsons(packageJsons);
  return {
    mainModulePath: cssPath,
    nodeModuleImportPaths,
    nodeModulePaths,
    packageJsons,
    componentModules: await builder.buildComponentModules(packageJsons),
    contexts: await builder.buildComponentContexts(packageJsons),
    importPaths: await builder.buildComponentImportPaths(packageJsons),
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

/** Seed one isolated account per target start (one start per conformance test file). */
export async function seedCssAccount(base: string, transport: typeof fetch = fetch) {
  let cookie = "";
  const json = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const url = new URL(path, base);
    assert.equal(url.origin, new URL(base).origin, "Foreign account control");
    assert(!url.username && !url.password, "Credential-bearing account control");
    const response = await transport(url, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    // Never include account API response bodies (credentials) in errors or reports.
    assert(response.ok, "CSS account operation failed");
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid CSS account response");
    }
  };
  const name = `conformance-${randomUUID()}`;
  const root = new URL(`${name}/`, base).href;
  const webId = `${root}profile/card#me`;
  await json(".account/account/", {});
  const { controls } = await json(".account/");
  const control = controls as {
    password: { create: string };
    account: { pod: string; clientCredentials: string };
  };
  await json(control.password.create, { email: `${name}@example.com`, password: randomUUID() });
  await json(control.account.pod, { name });
  const credentials = await json(control.account.clientCredentials, { name: "conformance", webId });
  assert(
    typeof credentials.id === "string" && typeof credentials.secret === "string",
    "Missing client credentials",
  );
  return { root, webId, clientId: credentials.id, clientSecret: credentials.secret };
}

/** File-backed CSS in this process, a free loopback port and disposable data directory. */
export const cssTarget: ConformanceTarget = {
  name: "css",
  async start() {
    // Keep the slow Components.js module graph out of memory-only runs.
    const { AppRunner } = await import("@solid/community-server");
    const directory = await mkdtemp(join(tmpdir(), "storage-conformance-css-"));
    let app: Awaited<ReturnType<InstanceType<typeof AppRunner>["create"]>> | undefined;
    let auth: PodAuth | undefined;
    const stop = async () => {
      try {
        await auth?.logout();
      } finally {
        try {
          await app?.stop();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    };
    try {
      const port = await freePort();
      const base = `http://localhost:${port}/`;
      app = await new AppRunner().create({
        config: "@css:config/file.json",
        loaderProperties: { logLevel: "error", moduleState: await moduleState() },
        shorthand: { port, baseUrl: base, rootFilePath: directory, loggingLevel: "error" },
      });
      await app.start();
      const { root, webId, clientId, clientSecret } = await seedCssAccount(base);
      auth = await forClientCredentials({
        issuer: base,
        clientId,
        clientSecret,
        boundary: [root],
        allowInsecureLoopback: true,
      });
      // CSS's default root is public. Seed an owner-only root ACL through the SDK;
      // the separately managed public profile remains available for WebID verification.
      const seed = await createPodClient({
        fetch: auth.fetch,
        storage: root,
        capabilities: createMemoryCache(),
      });
      const acl = (await seed.storage.head(root)).links.get("acl")?.[0]?.target;
      assert(acl, "CSS root must advertise its ACL");
      const validator = (await seed.storage.head(acl)).etag;
      assert(validator, "Root ACL must have a validator");
      const rules = await parseRdf(
        "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#owner> a acl:Authorization; acl:agent <profile/card#me>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Append, acl:Control.",
        "text/turtle",
        { baseIRI: root },
      );
      await seed.storage.writeRdf(acl, rules, { ifMatch: validator });
      const anonymous = await fetch(root, { redirect: "error" });
      await anonymous.body?.cancel();
      assert([401, 403].includes(anonymous.status), "CSS fixture root must be private");
      const session = recordingSession("css", auth.fetch);
      const { storage } = await createPodClient({
        fetch: session.fetch,
        storage: root,
        capabilities: createMemoryCache(),
      });
      return {
        root,
        webId,
        storage,
        ...session,
        claims: {
          protocol: "solid",
          accessControl: {
            state: "unknown",
            evidence: "CSS OPTIONS omits ACL and WAC-Allow",
            detail: { model: "none" },
          },
          move: {
            state: "available",
            evidence: "emulated",
            detail: { native: false, containers: true, preservesIdentifier: false },
          },
        },
        async authFetchFor(identity) {
          if (identity === webId) return session.fetch;
          throw new StorageError("unsupported", { method: "AUTH", url: root });
        },
        stop,
      };
    } catch (error) {
      await stop();
      throw error;
    }
  },
};
