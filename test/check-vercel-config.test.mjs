// AUTHORED-BY Codex GPT-5.6 (Sol)
// AUTHORED-BY Codex GPT-6.1 (Sol)
// AUTHORED-BY Codex GPT-6

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "./helpers/run-command.mjs";

const guard = fileURLToPath(new URL("../scripts/check-vercel-config.mjs", import.meta.url));
const checkout = dirname(dirname(guard));
const dirs = [];
const viteApp = {
  project: "solid-example",
  rootDirectory: "apps/example/web",
  package: "@jeswr/example-web",
  framework: "vite",
  originEnv: "APP_ORIGIN",
};
const nextApp = {
  project: "solid-next",
  rootDirectory: "apps/next",
  package: "@jeswr/app-next",
  framework: "next",
  originEnv: "NEXT_PUBLIC_APP_ORIGIN",
};
const vercelConfig = {
  git: { deploymentEnabled: false },
  rewrites: [{ source: "/((?!assets/|.*\\.[^/]+$).*)", destination: "/index.html" }],
  headers: [
    {
      source: "/clientid.jsonld",
      headers: [
        { key: "Content-Type", value: "application/ld+json" },
        { key: "Access-Control-Allow-Origin", value: "*" },
      ],
    },
  ],
};
const nextRoute = `export const dynamic = "force-static";
export function GET() {
  return new Response(JSON.stringify({ client_id: "https://example.org/clientid.jsonld", redirect_uris: [] }), {
    headers: { "content-type": "application/ld+json" }
  });
}`;
const viteConfig = `import { defineConfig, loadEnv } from "vite";
import { hostedClientIdConfig } from "./src/lib/hosted-client-id.js";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (!env.APP_ORIGIN) return {};
  return hostedClientIdConfig(env, { client_id: "/clientid.jsonld" });
});`;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtures(apps = [viteApp]) {
  const files = {
    "scripts/vercel-apps.json": apps.map((app) => ({
      ...app,
      gitDeploymentEnabled: app.project === "solid-suite" ? { "**": false, main: true } : false,
      vercelIgnore: `node ${relative(app.rootDirectory, "scripts/vercel-ignore-build.mjs")} ${app.package}`,
    })),
    "scripts/vercel-ignore-build.mjs": "// fixture ignored-build script",
  };
  for (const app of apps) {
    files[`${app.rootDirectory}/package.json`] = {
      name: app.package,
      private: true,
      scripts: {
        build:
          app.framework === "vite" ? "node scripts/gen-clientid.mjs && vite build" : "next build",
      },
    };
    if (app.framework === "vite") {
      files[`${app.rootDirectory}/vercel.json`] = structuredClone(vercelConfig);
    } else {
      files[`${app.rootDirectory}/vercel.json`] = { git: { deploymentEnabled: false } };
      files[`${app.rootDirectory}/src/app/clientid.jsonld/route.ts`] = nextRoute;
    }
    if (app.originEnv === "APP_ORIGIN" || app.framework === "vite") {
      files[`${app.rootDirectory}/turbo.json`] = {
        extends: ["//"],
        tasks: { build: { env: [app.originEnv] } },
      };
    }
  }
  return files;
}

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "vercel-config-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

function scan(files) {
  return runNode([guard, "--root", workspace(files)]);
}

function runNode(args, options = {}) {
  const result = runCommand(process.execPath, args, options);
  expect(result.error).toBeUndefined();
  return result;
}

function expectFailure(files, message) {
  const result = scan(files);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Vercel config guard failed:");
  expect(result.stderr).toContain(message);
  expect(result.stderr).not.toContain("TypeError");
  expect(result.stdout).toBe("");
}

describe("Vercel config guard", () => {
  it.each([
    "$comment",
    "unknownProperty",
    "buildComand",
    "__proto__",
  ])("rejects unknown top-level property %s in listed and unlisted apps", (key) => {
    for (const path of [
      "apps/example/web/vercel.json",
      "apps/next/vercel.json",
      "apps/unlisted/vercel.json",
      "apps/unlisted/web/vercel.json",
    ]) {
      const files = fixtures([viteApp, nextApp]);
      files[path] = { ...(files[path] ?? { git: { deploymentEnabled: false } }), [key]: "invalid" };
      expectFailure(files, `${path}: unknown top-level property ${key}`);
    }
  });

  it("accepts schema metadata and supported Vercel top-level options", () => {
    const files = fixtures();
    Object.assign(files["apps/example/web/vercel.json"], {
      // biome-ignore lint/style/useNamingConvention: Vercel's schema metadata key.
      $schema: "https://openapi.vercel.sh/vercel.json",
      buildCommand: "vite build",
      framework: "vite",
      outputDirectory: "dist",
      cleanUrls: true,
      trailingSlash: false,
    });
    expect(scan(files).status).toBe(0);
  });

  it("rejects an array in place of a Vercel configuration object", () => {
    const files = fixtures();
    files["apps/example/web/vercel.json"] = [];
    expectFailure(files, "apps/example/web/vercel.json: expected a configuration object");
  });

  const suiteApp = {
    ...nextApp,
    project: "solid-suite",
    rootDirectory: "apps/suite",
    package: "@jeswr/app-suite",
    clientIdDocument: false,
  };

  function suiteFixture() {
    const files = fixtures([suiteApp]);
    files["apps/suite/vercel.json"] = {
      git: { deploymentEnabled: { "**": false, main: true } },
      ignoreCommand: files["scripts/vercel-apps.json"][0].vercelIgnore,
    };
    return files;
  }

  it("allows only main for suite and preserves its ignored-build step", () => {
    expect(scan(suiteFixture()).status).toBe(0);
  });

  it.each([
    undefined,
    true,
    false,
    { main: true },
    { "*": false },
    { "*": false, main: true },
    { "*": true, main: true },
    { "**": false, main: true, preview: true },
  ])("rejects a suite git deployment policy that is not main only: %j", (deploymentEnabled) => {
    const files = suiteFixture();
    files["apps/suite/vercel.json"].git.deploymentEnabled = deploymentEnabled;
    expectFailure(files, "apps/suite/vercel.json: git.deploymentEnabled must be");
  });

  it("requires suite's ignoreCommand in vercel.json", () => {
    const files = suiteFixture();
    delete files["apps/suite/vercel.json"].ignoreCommand;
    expectFailure(files, "ignoreCommand must match vercelIgnore");
  });

  it.each([
    viteApp,
    nextApp,
  ])("disables git deployments for every non-suite $framework app", (app) => {
    for (const deploymentEnabled of [undefined, true, { main: true }, { "*": false }]) {
      const files = fixtures([app]);
      files[`${app.rootDirectory}/vercel.json`].git.deploymentEnabled = deploymentEnabled;
      expectFailure(files, "git.deploymentEnabled must be false");
    }
  });

  it("prevents a new app from enabling git deploys through the inventory", () => {
    const files = fixtures();
    files["scripts/vercel-apps.json"][0].gitDeploymentEnabled = { "**": false, main: true };
    files["apps/example/web/vercel.json"].git.deploymentEnabled = { "**": false, main: true };
    expectFailure(files, "solid-example: gitDeploymentEnabled must be false");
  });

  it("rejects a missing inventory policy and duplicate entries", () => {
    const files = fixtures();
    delete files["scripts/vercel-apps.json"][0].gitDeploymentEnabled;
    expectFailure(files, "gitDeploymentEnabled must be false");
    files["scripts/vercel-apps.json"].push(files["scripts/vercel-apps.json"][0]);
    expectFailure(files, "duplicate deployment root or project");
  });

  it.each([
    "apps/pod-migrator/vercel.json",
    "apps/new-app/web/vercel.json",
  ])("checks deployment policy for unlisted config %s", (path) => {
    for (const config of [
      {},
      { git: null },
      { git: {} },
      ...[true, null, "false", { "*": false }, { main: true }].map((deploymentEnabled) => ({
        git: { deploymentEnabled },
      })),
    ]) {
      expectFailure(
        { ...fixtures(), [path]: config },
        `${path}: git.deploymentEnabled must be false`,
      );
    }
    expect(scan({ ...fixtures(), [path]: { git: { deploymentEnabled: false } } }).status).toBe(0);
    expectFailure({ ...fixtures(), [path]: "{" }, `${path}: invalid JSON`);
  });

  const deployableManifests = [
    { scripts: { build: "custom-build" } },
    ...["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
      (field) => ["next", "vite"].map((framework) => ({ [field]: { [framework]: "*" } })),
    ),
  ];

  for (const directory of ["apps/pod-migrator", "apps/new-app/web"]) {
    it.each(
      deployableManifests,
    )(`requires an absent disabling config for unlisted ${directory} with %j`, (manifest) => {
      const files = { ...fixtures(), [`${directory}/package.json`]: manifest };
      expectFailure(files, `${directory}/vercel.json: missing or unreadable file`);
      files[`${directory}/vercel.json`] = { git: { deploymentEnabled: false } };
      expect(scan(files).status).toBe(0);
    });
  }

  it.each([viteApp, nextApp])("rejects a missing config for registered $framework apps", (app) => {
    const files = fixtures([app]);
    delete files[`${app.rootDirectory}/vercel.json`];
    expectFailure(files, `${app.rootDirectory}/vercel.json: missing or unreadable file`);
  });

  it("leaves non-build app directories outside discovery", () => {
    const files = {
      ...fixtures(),
      "apps/mobile/package.json": { scripts: { test: "vitest run", build: " " } },
      "apps/example/package.json": { private: true },
    };
    expect(scan(files).status).toBe(0);
  });

  it("rejects an unreadable manifest instead of silently omitting a future app", () => {
    expectFailure(
      { ...fixtures(), "apps/new-app/package.json": "{" },
      "apps/new-app/package.json: invalid JSON",
    );
  });

  it("keeps the suite's main-only exception when discovered outside the inventory", () => {
    const files = {
      ...fixtures(),
      "apps/suite/package.json": { dependencies: { next: "*" } },
      "apps/suite/vercel.json": { git: { deploymentEnabled: { "**": false, main: true } } },
    };
    expect(scan(files).status).toBe(0);
    files["apps/suite/vercel.json"].git.deploymentEnabled = true;
    expectFailure(
      files,
      'apps/suite/vercel.json: git.deploymentEnabled must be { "**": false, "main": true }',
    );
  });

  it("checks every deployment and accepts Next.js framework-inferred public env", () => {
    const result = scan(fixtures([viteApp, nextApp]));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Vercel config guard passed (2 deployments checked).");
    expect(result.stderr).toBe("");
  });

  it.each([
    viteApp,
    { ...nextApp, originEnv: "APP_ORIGIN" },
  ])("accepts $framework without a client ID mechanism or Turbo env config when clientIdDocument is false", (app) => {
    const files = fixtures([{ ...app, clientIdDocument: false }]);
    files[`${app.rootDirectory}/package.json`].scripts.build = `${app.framework} build`;
    delete files[`${app.rootDirectory}/src/app/clientid.jsonld/route.ts`];
    delete files[`${app.rootDirectory}/turbo.json`];
    const result = scan(files);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 deployments checked");
    expect(result.stderr).toBe("");

    delete files["scripts/vercel-apps.json"][0].originEnv;
    expect(scan(files).status).toBe(0);
  });

  it("accepts Next.js without originEnv or a Turbo config when a request-derived client ID route exists", () => {
    const files = fixtures([{ ...nextApp, originEnv: undefined }]);
    files["apps/next/src/app/clientid.jsonld/route.ts"] = `export const dynamic = "force-dynamic";
export function GET(request) {
  return new Response(JSON.stringify({
    client_id: new URL("/clientid.jsonld", request.url).toString(),
    redirect_uris: [new URL("/callback.html", request.url).toString()]
  }), { headers: { "content-type": "application/ld+json" } });
}`;
    expect(files["apps/next/turbo.json"]).toBeUndefined();
    const result = scan(files);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    undefined,
    true,
  ])("rejects Vite without originEnv when clientIdDocument is %j", (clientIdDocument) => {
    const files = fixtures([{ ...viteApp, originEnv: undefined, clientIdDocument }]);
    expectFailure(files, "scripts/vercel-apps.json[0]: invalid deployment entry");
  });

  it.each([viteApp, nextApp])("rejects unsupported originEnv values for $framework", (app) => {
    for (const originEnv of [null, "", "VITE_APP_ORIGIN", "OTHER_APP_ORIGIN"]) {
      for (const clientIdDocument of [undefined, false]) {
        const files = fixtures([{ ...app, originEnv, clientIdDocument }]);
        expectFailure(files, "scripts/vercel-apps.json[0]: invalid deployment entry");
      }
    }
  });

  it.each([
    "false",
    "true",
    0,
    1,
    null,
    {},
    [],
  ])("rejects a non-boolean clientIdDocument: %j", (clientIdDocument) => {
    const files = fixtures([{ ...viteApp, clientIdDocument }]);
    expectFailure(files, "scripts/vercel-apps.json[0]: clientIdDocument must be a boolean");
  });

  it.each([
    undefined,
    true,
  ])("requires client ID generation and origin env config when clientIdDocument is %j", (clientIdDocument) => {
    const files = fixtures([{ ...viteApp, clientIdDocument }]);
    files["apps/example/web/package.json"].scripts.build = "vite build";
    delete files["apps/example/web/turbo.json"];
    const result = scan(files);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("build/prebuild must generate clientid.jsonld");
    expect(result.stderr).toContain("apps/example/web/turbo.json: missing or unreadable file");

    delete files["scripts/vercel-apps.json"][0].originEnv;
    expectFailure(files, "scripts/vercel-apps.json[0]: invalid deployment entry");
  });

  it("keeps other checks enabled when clientIdDocument is false", () => {
    const files = fixtures([{ ...viteApp, clientIdDocument: false }]);
    files["apps/example/web/package.json"].name = "@jeswr/other";
    files["apps/example/web/package.json"].private = false;
    delete files["scripts/vercel-apps.json"][0].vercelIgnore;
    files["apps/example/web/vercel.json"] = {};
    const result = scan(files);
    expect(result.status).toBe(1);
    for (const message of [
      "package name must match",
      "deployed package must be private",
      "vercelIgnore must be a command",
      "missing SPA rewrite",
      "/clientid.jsonld headers must include Content-Type",
      "/clientid.jsonld headers must include Access-Control-Allow-Origin",
    ]) {
      expect(result.stderr).toContain(message);
    }
  });

  it("accepts a prebuild generator and case-insensitive client ID headers", () => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts = {
      prebuild: "node scripts/gen-clientid.mjs",
      build: "vite build",
    };
    files["apps/example/web/vercel.json"].headers[0].headers = [
      { key: "content-type", value: "application/ld+json; charset=utf-8" },
      { key: "access-control-allow-origin", value: "*" },
    ];
    expect(scan(files).status).toBe(0);
  });

  it("accepts a Vite config that emits the client ID from APP_ORIGIN during build", () => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts.build =
      "tsc -p tsconfig.build.json && vite build";
    files["apps/example/web/vite.config.ts"] = viteConfig;
    expect(scan(files).status).toBe(0);
  });

  it.each([
    "missing config",
    "no document",
    "wrong origin",
    "unrelated build",
  ])("rejects a Vite client ID mechanism with %s", (kind) => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts.build = "vite build";
    if (kind !== "missing config") files["apps/example/web/vite.config.ts"] = viteConfig;
    if (kind === "no document")
      files["apps/example/web/vite.config.ts"] = viteConfig.replaceAll(
        "clientid.jsonld",
        "other.json",
      );
    if (kind === "wrong origin")
      files["apps/example/web/vite.config.ts"] = viteConfig.replaceAll(
        "APP_ORIGIN",
        "OTHER_ORIGIN",
      );
    if (kind === "unrelated build")
      files["apps/example/web/package.json"].scripts.build = "echo built";
    expectFailure(
      files,
      "apps/example/web/package.json: build/prebuild must generate clientid.jsonld",
    );
  });

  it.each([
    [
      "comment-only",
      `// env.APP_ORIGIN "clientid.jsonld"\n/* env.APP_ORIGIN */\nexport default {};`,
    ],
    ["similarly named origin", viteConfig.replaceAll("env.APP_ORIGIN", "env.OTHER_APP_ORIGIN")],
  ])("rejects a %s Vite client ID config", (_kind, config) => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts.build = "vite build";
    files["apps/example/web/vite.config.ts"] = config;
    expectFailure(
      files,
      "apps/example/web/package.json: build/prebuild must generate clientid.jsonld",
    );
  });

  it.each([
    "vite build --config other.config.ts",
    "vite build -c other.config.ts",
    "vite build --config=other.config.ts",
  ])("rejects a Vite client ID config bypassed by %s", (build) => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts.build = build;
    files["apps/example/web/vite.config.ts"] = viteConfig;
    expectFailure(
      files,
      "apps/example/web/package.json: build/prebuild must generate clientid.jsonld",
    );
  });

  it.each(["/(.*)", "/:path*", "/:path(.*)"])("accepts the SPA catch-all %s", (source) => {
    const files = fixtures();
    files["apps/example/web/vercel.json"].rewrites = [{ source, destination: "/index.html" }];
    expect(scan(files).status).toBe(0);
  });

  it.each([
    "missing",
    "invalid JSON",
    "empty array",
    "object",
    "null",
    "invalid entry",
  ])("rejects a deployment manifest that is %s", (kind) => {
    const files = fixtures();
    const path = "scripts/vercel-apps.json";
    if (kind === "missing") delete files[path];
    if (kind === "invalid JSON") files[path] = "{";
    if (kind === "empty array") files[path] = [];
    if (kind === "object") files[path] = {};
    if (kind === "null") files[path] = "null";
    if (kind === "invalid entry") files[path] = [{ ...viteApp, package: "" }];
    expectFailure(files, path);
  });

  it("rejects a missing rootDirectory", () => {
    const files = fixtures();
    files["scripts/vercel-apps.json"][0] = { ...viteApp, rootDirectory: "apps/missing" };
    expectFailure(files, "solid-example: rootDirectory apps/missing is missing or not a directory");
  });

  it.each([
    "missing",
    "invalid JSON",
    "missing name",
    "wrong name",
    "not private",
    "private string",
  ])("rejects a package manifest with %s", (kind) => {
    const files = fixtures();
    const path = "apps/example/web/package.json";
    if (kind === "missing") delete files[path];
    if (kind === "invalid JSON") files[path] = "{";
    if (kind === "missing name") delete files[path].name;
    if (kind === "wrong name") files[path].name = "@jeswr/other";
    if (kind === "not private") delete files[path].private;
    if (kind === "private string") files[path].private = "true";
    expectFailure(files, path);
  });

  it.each(["missing", "invalid JSON"])("rejects a %s Vercel config", (kind) => {
    const files = fixtures();
    const path = "apps/example/web/vercel.json";
    if (kind === "missing") delete files[path];
    else files[path] = "{";
    expectFailure(
      files,
      `${path}: ${kind === "missing" ? "missing or unreadable file" : "invalid JSON"}`,
    );
  });

  it.each(
    [
      undefined,
      [],
      {},
      [null],
      [{ source: "/(.*)", destination: "/other.html" }],
      [{ source: "/login", destination: "/index.html" }],
      [{ source: "/(", destination: "/index.html" }],
    ].map((rewrites) => ({ rewrites })),
  )("rejects missing or ineffective SPA rewrites: $rewrites", ({ rewrites }) => {
    const files = fixtures();
    files["apps/example/web/vercel.json"].rewrites = rewrites;
    expectFailure(files, "apps/example/web/vercel.json: missing SPA rewrite to /index.html");
  });

  it.each([
    ["Content-Type", "text/html"],
    ["Access-Control-Allow-Origin", "https://example.org"],
  ])("rejects an incorrect client ID %s", (key, value) => {
    const files = fixtures();
    const headers = files["apps/example/web/vercel.json"].headers[0].headers;
    headers.find((header) => header.key === key).value = value;
    expectFailure(files, `/clientid.jsonld headers must include ${key}`);
  });

  it.each(
    [
      undefined,
      [],
      {},
      [null],
      [{ source: "/other.jsonld", headers: vercelConfig.headers[0].headers }],
    ].map((headers) => ({ headers })),
  )("rejects missing or misplaced client ID headers: $headers", ({ headers }) => {
    const files = fixtures();
    files["apps/example/web/vercel.json"].headers = headers;
    expectFailure(files, "/clientid.jsonld headers must include Content-Type: application/ld+json");
  });

  it.each([
    "missing",
    "invalid JSON",
    "no extends",
    "no build",
    "wrong env",
    "passthrough env",
  ])("rejects a Turbo build config with %s", (kind) => {
    const files = fixtures();
    const path = "apps/example/web/turbo.json";
    if (kind === "missing") delete files[path];
    if (kind === "invalid JSON") files[path] = "{";
    if (kind === "no extends") files[path].extends = [];
    if (kind === "no build") files[path].tasks = {};
    if (kind === "wrong env") files[path].tasks.build.env = ["VITE_APP_ORIGIN"];
    if (kind === "passthrough env") {
      files[path].tasks.build = { passThroughEnv: ["APP_ORIGIN"] };
    }
    expectFailure(files, path);
  });

  it("requires an explicit Turbo build env for a Next.js server origin", () => {
    const files = fixtures([{ ...nextApp, originEnv: "APP_ORIGIN" }]);
    expect(scan(files).status).toBe(0);
    files["apps/next/turbo.json"].tasks.build.env = [];
    expectFailure(files, "apps/next/turbo.json: tasks.build.env must include APP_ORIGIN");
  });

  it.each([
    "missing command",
    "too long",
    "wrong package",
    "wrong path",
    "missing script",
  ])("rejects an ignored-build command with %s", (kind) => {
    const files = fixtures();
    const app = files["scripts/vercel-apps.json"][0];
    if (kind === "missing command") delete app.vercelIgnore;
    if (kind === "too long") app.vercelIgnore = "x".repeat(257);
    if (kind === "wrong package")
      app.vercelIgnore = app.vercelIgnore.replace(viteApp.package, "wrong");
    if (kind === "wrong path")
      app.vercelIgnore = `node ../../scripts/vercel-ignore-build.mjs ${app.package}`;
    if (kind === "missing script") delete files["scripts/vercel-ignore-build.mjs"];
    expectFailure(files, "solid-example: vercelIgnore");
  });

  it.each([
    {},
    { build: "vite build" },
    { dev: "node scripts/gen-clientid.mjs && vite", build: "vite build" },
    { "gen:clientid": "node scripts/gen-clientid.mjs", build: "vite build" },
    { prebuild: "node scripts/gen-clientid.mjs" },
  ])("rejects scripts that do not generate the client ID on build: %j", (scripts) => {
    const files = fixtures();
    files["apps/example/web/package.json"].scripts = scripts;
    expectFailure(
      files,
      "apps/example/web/package.json: build/prebuild must generate clientid.jsonld",
    );
  });

  it.each([
    "missing route",
    "incomplete route",
    "missing build",
    "unrelated build",
  ])("rejects a Next.js client ID mechanism with %s", (kind) => {
    for (const originEnv of [nextApp.originEnv, undefined]) {
      const files = fixtures([{ ...nextApp, originEnv }]);
      const route = "apps/next/src/app/clientid.jsonld/route.ts";
      if (kind === "missing route") delete files[route];
      if (kind === "incomplete route")
        files[route] = "export function GET() { return new Response(''); }";
      if (kind === "missing build") delete files["apps/next/package.json"].scripts.build;
      if (kind === "unrelated build") files["apps/next/package.json"].scripts.build = "echo built";
      expectFailure(files, "next build with a clientid.jsonld GET route");
    }
  });

  it("accepts a request-derived Next.js route formatted with trailing commas", () => {
    const files = fixtures([{ ...nextApp, originEnv: undefined }]);
    files["apps/next/src/app/clientid.jsonld/route.ts"] = `export function GET(request) {
  return new Response(JSON.stringify({
    client_id: new URL(
      "/clientid.jsonld",
      request.url,
    ).toString(),
    redirect_uris: [],
  }), { headers: { "content-type": "application/ld+json" } });
}`;
    expect(scan(files).status).toBe(0);
  });

  it.each([
    ["a static origin", nextRoute.replace("force-static", "force-dynamic")],
    [
      "force-static",
      `export const dynamic = "force-static";
export function GET(request) {
  return new Response(JSON.stringify({
    client_id: new URL("/clientid.jsonld", request.url).toString(),
    redirect_uris: [new URL("/callback.html", request.url).toString()]
  }), { headers: { "content-type": "application/ld+json" } });
}`,
    ],
  ])("rejects a Next.js route without originEnv that has %s", (_kind, route) => {
    const files = fixtures([{ ...nextApp, originEnv: undefined }]);
    files["apps/next/src/app/clientid.jsonld/route.ts"] = route;
    expectFailure(files, "GET route deriving client_id from the request URL");
  });

  it("requires a Next.js route without originEnv even when a generator is configured", () => {
    const files = fixtures([{ ...nextApp, originEnv: undefined }]);
    delete files["apps/next/src/app/clientid.jsonld/route.ts"];
    files["apps/next/package.json"].scripts.build = "node scripts/gen-clientid.mjs && next build";
    expectFailure(files, "next build with a clientid.jsonld GET route");
  });

  it("accepts a Next.js route under app/ instead of src/app/", () => {
    const files = fixtures([nextApp]);
    delete files["apps/next/src/app/clientid.jsonld/route.ts"];
    files["apps/next/app/clientid.jsonld/route.js"] = nextRoute;
    expect(scan(files).status).toBe(0);
  });

  it("reports failures across deployments in one run", () => {
    const files = fixtures([viteApp, nextApp]);
    files["apps/example/web/package.json"].private = false;
    delete files["apps/next/src/app/clientid.jsonld/route.ts"];
    const result = scan(files);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deployed package must be private");
    expect(result.stderr).toContain("next build with a clientid.jsonld GET route");
  });

  it("runs through a symlinked entry point", () => {
    const root = workspace(fixtures());
    const entry = join(root, "guard.mjs");
    symlinkSync(guard, entry);
    const result = runNode([entry, "--root", root]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 deployments checked");
  });

  it("imports without running the CLI", () => {
    const result = runNode(
      ["--input-type=module", "--eval", `await import(${JSON.stringify(guard)});`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("checks the actual manifest independent of the invoking directory", () => {
    const result = runNode([guard], { cwd: tmpdir() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("15 deployments checked");
    expect(result.stderr).toBe("");
  });
});

describe("Vite app Vercel routes", () => {
  const apps = JSON.parse(readFileSync(join(checkout, "scripts/vercel-apps.json"), "utf8"));
  for (const app of apps.filter((app) => app.framework === "vite")) {
    // Rewritten nested paths serve index.html, so Vercel builds need root-absolute assets.
    it(`${app.project} builds root-absolute asset URLs on Vercel`, () => {
      const vite = readFileSync(join(checkout, app.rootDirectory, "vite.config.ts"), "utf8");
      if (app.rootDirectory === "apps/access-manager") {
        expect(vite).not.toMatch(/\bbase\s*:/);
        return;
      }
      if (app.rootDirectory === "apps/pod-migrator") {
        // Absolute base from CLIENT_BASE_PATH ("/" unless a Pages build sets it).
        expect(vite).toContain("deploymentBasePath(env.CLIENT_BASE_PATH || env.APP_BASE_PATH)");
        return;
      }
      expect(vite).toContain('base: process.env.VERCEL === "1" ? "/" : "./",');
      const turbo = JSON.parse(
        readFileSync(join(checkout, app.rootDirectory, "turbo.json"), "utf8"),
      );
      expect(turbo.tasks.build.env).toContain("VERCEL");
    });
  }
  for (const app of apps.filter(
    (app) => app.framework === "vite" && app.project !== "solid-app-store",
  )) {
    it(`${app.project} preserves static URLs and rewrites nested navigation`, () => {
      const config = JSON.parse(
        readFileSync(join(checkout, app.rootDirectory, "vercel.json"), "utf8"),
      );
      const pattern = new RegExp(`^${config.rewrites[0].source}$`);
      for (const path of ["/", "/deep/link", "/deep/link/"]) expect(pattern.test(path)).toBe(true);
      for (const path of [
        "/assets/app.js",
        "/assets/style.css",
        "/callback.html",
        "/clientid.jsonld",
        "/manifest.webmanifest",
        "/sw.js",
        "/nested/catalog.ttl",
      ]) {
        expect(pattern.test(path), path).toBe(false);
      }
      expect(config.headers.map((entry) => entry.source)).toEqual(["/clientid.jsonld", "/(.*)"]);
      expect(config.headers[1].headers).toContainEqual({
        key: "X-Content-Type-Options",
        value: "nosniff",
      });
    });
  }
});
