// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname } from "node:path";

// Reuse storage-conformance's pinned CSS 7 dependency; do not add an app dependency or use npx.
const requireCss = createRequire(
  new URL("../../../../tools/storage-conformance/package.json", import.meta.url),
);
const cssPackage = requireCss.resolve("@solid/community-server/package.json");
const cssPath = dirname(cssPackage);
const { AppRunner } = requireCss("@solid/community-server");

// Same dependency-closure isolation as tools/storage-conformance/src/targets/css.ts:
// Components.js must not mix CSS 7 with the workspace's other server dependency graphs.
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

const port = Number(process.env.SUITE_CSS_PORT);
assert(Number.isInteger(port) && port > 0 && port <= 65535, "Invalid SUITE_CSS_PORT");
const origin = `http://localhost:${port}/`;
const app = await new AppRunner().create({
  config: "@css:config/default.json",
  loaderProperties: { logLevel: "error", moduleState: await moduleState() },
  shorthand: { port, baseUrl: origin, loggingLevel: "error" },
});

let stopping;
const stop = () => {
  stopping ??= app.stop();
  return stopping;
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void stop().then(() => process.exit(0));
  });

async function seedAccount(name) {
  // A separate cookie jar for each account prevents Bob from being linked to Alice.
  let cookie = "";
  const json = async (path, body) => {
    const url = new URL(path, origin);
    assert.equal(url.origin, new URL(origin).origin, "Foreign CSS account control");
    assert(!url.username && !url.password, "Credential-bearing CSS account control");
    const response = await fetch(url, {
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
    // Account responses can contain credentials: report only the operation and status.
    assert(response.ok, `CSS seed ${name}: ${url.pathname} returned ${response.status}`);
    return response.json();
  };
  await json(".account/account/", {});
  const { controls } = await json(".account/");
  await json(controls.password.create, {
    email: `${name}@example.com`,
    // Disposable local credentials; keep in sync with fixtures.ts.
    password: "shell-css-password-123!",
  });
  await json(controls.account.pod, {
    name,
    // Let CSS's own pod templates emit the name and storage link; no hand-built RDF.
    settings: { name: name === "alice" ? "Alice" : "Bob", linkStorage: true },
  });
}

try {
  await app.start();
  await seedAccount("alice");
  await seedAccount("bob");
  console.log("CSS ready: alice and bob have password logins and pods.");
} catch (error) {
  await stop();
  throw error;
}
