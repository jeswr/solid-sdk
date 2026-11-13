// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// CSS dependency isolation and account controls follow suite/e2e/shell-css/server.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const requireCss = createRequire(
  new URL("../../../tools/storage-conformance/package.json", import.meta.url),
);
const requireSuite = createRequire(new URL("../../suite/package.json", import.meta.url));
const cssPackage = requireCss.resolve("@solid/community-server/package.json");
const cssPath = dirname(cssPackage);
const { AppRunner } = requireCss("@solid/community-server");
async function moduleState() {
  const { ModuleStateBuilder } = createRequire(cssPackage)("componentsjs");
  const builder = new ModuleStateBuilder();
  const roots = new Set([cssPath]);
  const paths = new Set();
  let pending = [cssPath];
  const enqueueVirtualRoot = (path) => {
    const virtual = /^(.*\/node_modules\/\.pnpm\/[^/]+)\/node_modules\//.exec(path);
    if (virtual?.[1] && !roots.has(virtual[1])) {
      roots.add(virtual[1]);
      pending.push(virtual[1]);
    }
  };
  enqueueVirtualRoot(cssPath);
  while (pending.length > 0) {
    const found = await builder.buildNodeModulePaths(pending);
    pending = [];
    for (const path of found) {
      paths.add(path);
      roots.add(path);
      enqueueVirtualRoot(path);
    }
  }
  const nodeModulePaths = [...paths];
  const packageJsons = await builder.buildPackageJsons(nodeModulePaths);
  await builder.preprocessPackageJsons(packageJsons);
  return {
    mainModulePath: cssPath,
    nodeModuleImportPaths: [...roots],
    nodeModulePaths,
    packageJsons,
    componentModules: await builder.buildComponentModules(packageJsons),
    contexts: await builder.buildComponentContexts(packageJsons),
    importPaths: await builder.buildComponentImportPaths(packageJsons),
  };
}

// An IP-literal host, not localhost: bundled builds refuse every localhost origin other than the
// app's own https://localhost (SuiteWebViewClient.isOtherLocalOrigin), so CSS cannot share the name.
export const ORIGIN = "https://127.0.0.1:8443";
export const CLIENT_ID = `${ORIGIN}/.well-known/solid-client-id-mobile.jsonld`;
export const PRIVATE_BODY = 'MOB-07 private resource\nExact bytes: quotes " and unicode café.\n';

/** A private Unix socket backs the single IPv4-loopback TLS listener. No wildcard CSS port. */
export async function startRealSuiteServer(tlsDir, progress = () => {}) {
  progress("load SDK and pinned CSS");
  const { mobileClientIdDocument } = await import(requireSuite.resolve("@jeswr/suite-native"));
  const { forClientCredentials } = await import(requireSuite.resolve("@jeswr/pod-auth/node"));
  assert.equal(requireCss("@solid/community-server/package.json").version, "7.2.0");
  const socket = join(tlsDir, "css.sock");
  progress("create isolated CSS application");
  const app = await new AppRunner().create({
    config: "@css:config/default.json",
    loaderProperties: { logLevel: "error", moduleState: await moduleState() },
    shorthand: { port: 8443, socket, baseUrl: `${ORIGIN}/`, loggingLevel: "error" },
  });
  const document = mobileClientIdDocument({ origin: ORIGIN });
  let clientDocumentReads = 0;
  let schemeCallback = false;
  const server = createServer(
    {
      key: await readFile(join(tlsDir, "localhost.key")),
      cert: await readFile(join(tlsDir, "localhost.crt")),
    },
    (incoming, outgoing) => {
      if (incoming.url === "/.well-known/solid-client-id-mobile.jsonld") {
        clientDocumentReads++;
        outgoing.writeHead(200, {
          "content-type": "application/ld+json",
          "access-control-allow-origin": "*",
        });
        outgoing.end(JSON.stringify(document));
        return;
      }
      const upstream = request(
        {
          socketPath: socket,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, "x-forwarded-proto": "https" },
        },
        (response) => {
          if (response.headers.location?.startsWith("org.jeswr.suite:/oauth/callback?")) {
            const callback = new URL(response.headers.location);
            schemeCallback = ["code", "state", "iss"].every((key) =>
              callback.searchParams.has(key),
            );
          }
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    },
  );
  const stop = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.stop();
  };
  try {
    progress("start CSS and loopback TLS listener");
    await app.start();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(8443, "127.0.0.1", resolve);
    });
    const name = `mob07-${randomUUID()}`;
    const account = {
      email: `${name}@example.com`,
      password: randomUUID(),
      webId: `${ORIGIN}/${name}/profile/card#me`,
      name: "Mobile E2E",
      pod: `${ORIGIN}/${name}/`,
    };
    let cookie = "";
    const json = async (path, body) => {
      const url = new URL(path, `${ORIGIN}/`);
      assert.equal(url.origin, ORIGIN, "Foreign account control");
      assert(!url.username && !url.password, "Invalid account control");
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: "application/json",
          Cookie: cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      assert(response.ok, `CSS account operation failed: HTTP ${response.status}`);
      return response.json();
    };
    progress("create account, password login and pod");
    await json("/.account/account/", {});
    const { controls } = await json("/.account/");
    await json(controls.password.create, { email: account.email, password: account.password });
    await json(controls.account.pod, { name, settings: { name: account.name, linkStorage: true } });
    progress("create host arrangement credentials");
    const credentials = await json(controls.account.clientCredentials, {
      name: "MOB-07 arrangement",
      webId: account.webId,
    });
    // Host-only data arrangement. These credentials never enter either browser or the report.
    progress("authenticate host arrangement client");
    const auth = await forClientCredentials({
      issuer: `${ORIGIN}/`,
      clientId: credentials.id,
      clientSecret: credentials.secret,
      boundary: [account.pod],
    });
    const resource = `${account.pod}mob07-private.txt`;
    progress("write and verify private seed body");
    const seeded = await auth.fetch(resource, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: PRIVATE_BODY,
    });
    assert(seeded.ok, `Private resource seed failed: HTTP ${seeded.status}`);
    const anonymous = await fetch(resource, { signal: AbortSignal.timeout(30000) });
    await anonymous.arrayBuffer();
    assert([401, 403].includes(anonymous.status), "Seed resource is not private");
    const verified = await auth.fetch(resource);
    assert(
      verified.ok && (await verified.text()) === PRIVATE_BODY,
      "Seed body verification failed",
    );
    const cid = await fetch(CLIENT_ID, { signal: AbortSignal.timeout(30000) });
    assert(
      cid.ok && (await cid.json()).client_id === CLIENT_ID,
      "Client document is not dereferenceable",
    );
    return {
      account,
      resource,
      anonymousStatus: anonymous.status,
      stop,
      evidence: () => ({ clientDocumentReads, schemeCallback }),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
