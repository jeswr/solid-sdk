// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const guard = fileURLToPath(new URL("../scripts/check-sdk-layers.mjs", import.meta.url));
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scan(manifests) {
  const root = mkdtempSync(join(tmpdir(), "sdk-layers-"));
  dirs.push(root);
  for (const [path, manifest] of Object.entries(manifests)) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, JSON.stringify(manifest));
  }
  return spawnSync(process.execPath, [guard, "--root", root], { encoding: "utf8" });
}

describe("SDK layer guard", () => {
  it("scans the same current tree when invoked outside the checkout", () => {
    const baseline = spawnSync(process.execPath, [guard], {
      cwd: dirname(dirname(guard)),
      encoding: "utf8",
    });
    const result = spawnSync(process.execPath, [guard], { cwd: tmpdir(), encoding: "utf8" });
    expect(baseline.status).toBe(0);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(baseline.stdout);
    expect(result.stderr).toBe(baseline.stderr);
    expect(result.stdout).toContain("SDK layer guard passed");
  });

  it("allows the seven storage-client dependencies, public app surfaces and plumbing", () => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: {
          "@jeswr/storage-capabilities": "workspace:*",
          "@jeswr/fetch-rdf": "workspace:*",
          "@jeswr/rdf-serialize": "workspace:*",
          "@jeswr/guarded-fetch": "workspace:*",
          "@solid/object": "^0.8.0",
          "@rdfjs/wrapper": "^0.34.0",
          n3: "^1.0.0",
        },
        devDependencies: { vitest: "^4.0.0", "@types/node": "^25.0.0" },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        dependencies: { "@jeswr/reactive-authentication": "workspace:*" },
      },
      "apps/example/package.json": {
        name: "@jeswr/app-example",
        dependencies: { "@jeswr/storage-client": "workspace:*", "@jeswr/pod-auth": "workspace:*" },
      },
      "apps/example/web/package.json": {
        dependencies: { "@jeswr/rdf-engine": "workspace:*" },
      },
      "packages/rdf-engine/package.json": {
        name: "@jeswr/rdf-engine",
        dependencies: { "@sparq-org/sparq": "0.1.5" },
      },
      "tools/storage-conformance/package.json": {
        dependencies: { "@jeswr/storage-client/solid": "workspace:*" },
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("6 manifests scanned");
  });

  it.each([
    "apps/example/package.json",
    "apps/example/web/package.json",
  ])("rejects sparq and both protocol backends in %s", (path) => {
    const result = scan({
      [path]: {
        dependencies: {
          "@sparq-org/sparq": "0.1.5",
          "@jeswr/storage-client/solid": "workspace:*",
          "@jeswr/storage-client/lws": "workspace:*",
        },
      },
    });
    expect(result.status).toBe(1);
    for (const name of [
      "@sparq-org/sparq",
      "@jeswr/storage-client/solid",
      "@jeswr/storage-client/lws",
    ]) {
      expect(result.stderr).toContain(`${path} dependencies.${name}`);
    }
    expect(result.stderr).toContain("apps must use the protocol-neutral SDK surface");
  });

  it.each([
    "@jeswr/pod-auth",
    "@jeswr/rdf-engine",
    "@rdfjs/types",
    "unlisted-package",
  ])("rejects storage-client dependency %s under the amended allowlist", (dependency) => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { [dependency]: "*" },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `packages/storage-client/package.json dependencies.${dependency}`,
    );
    expect(result.stderr).toContain("storage-client may depend only on");
  });

  it("rejects pod-auth depending on storage-client", () => {
    const result = scan({
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        dependencies: { "@jeswr/storage-client": "workspace:*" },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/pod-auth/package.json dependencies.@jeswr/storage-client",
    );
    expect(result.stderr).toContain("pod-auth must not depend on storage-client");
  });

  const acceptedSpecs = [
    "workspace:*",
    "workspace:^",
    "workspace:~",
    ...[
      "*",
      "0.1.0",
      "^0.1.0",
      "~0.1.0",
      "~>0.1.0",
      ">=0.1 <1",
      "1.0.0 - 2.0.0",
      "1.x || >=2.0.0 <3",
      "1.2.3-beta.1+build.5",
      "1.2.3-0.alpha-1+build.01",
      "1.2.3+build.5",
      "1.2.x-beta.1",
      "1",
      "1.2",
      "1.2.X",
      "=1.2.3",
      "v1.2.3",
      ">= 1.2.3 < 2.0.0",
    ].flatMap((range) => [range, `workspace:${range}`]),
  ];
  const unsupportedSpecs = [
    "workspace:../pod-auth",
    "workspace:./pod-auth",
    "workspace:/absolute/pod-auth",
    "workspace:n3@*",
    "workspace:@jeswr/fetch-rdf@^1.0.0",
    "workspace:n3",
    "workspace:@jeswr/fetch-rdf",
    "workspace:",
    "workspace:latest",
    "npm:n3@^1.0.0",
    "npm:@jeswr/fetch-rdf@^1.0.0",
    "npm:",
    "link:../pod-auth",
    "file:../pod-auth",
    "github:jeswr/pod-auth#private-ref",
    "git+https://example.invalid/pod-auth.git#private-ref",
    "git+ssh://git@example.invalid/pod-auth.git",
    "git@github.com:jeswr/pod-auth.git",
    "https://example.invalid/pod-auth.tgz?private-token",
    "example/unrelated",
    "../pod-auth",
    "latest",
    "next_build",
    "^",
    "~",
    "1.2.3 || latest",
    "workspace:1.2.3 || latest",
    "1.2.3.4",
    "01.2.3",
    "1.2.3-01",
    "1.2.3+",
    ">=",
    "",
    " ",
    null,
    1,
  ];
  const fields = ["dependencies", "peerDependencies", "optionalDependencies"];

  it.each(acceptedSpecs)("accepts %s in layered manifests and under restricted keys", (spec) => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        ...Object.fromEntries(fields.map((field) => [field, { n3: spec }])),
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        ...Object.fromEntries(fields.map((field) => [field, { unrelated: spec }])),
      },
      "apps/example/package.json": {
        ...Object.fromEntries(fields.map((field) => [field, { "@jeswr/storage-client": spec }])),
      },
      "tools/example/package.json": {
        ...Object.fromEntries(fields.map((field) => [field, { "@jeswr/pod-auth": spec }])),
      },
    });
    expect(result.status).toBe(0);
  });

  it.each(acceptedSpecs)("applies layer rules to dependency keys for %s", (spec) => {
    const manifests = {
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { "@jeswr/pod-auth": spec },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        peerDependencies: { "@jeswr/storage-client": spec },
      },
      "apps/example/web/package.json": {
        optionalDependencies: { "@sparq-org/sparq/wasm-node": spec },
      },
    };
    const result = scan(manifests);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("storage-client may depend only on");
    expect(result.stderr).toContain("pod-auth must not depend on storage-client");
    expect(result.stderr).toContain("apps must use the protocol-neutral SDK surface");
    expect(result.stderr).not.toContain("unsupported dependency spec");
  });

  it.each(unsupportedSpecs)("rejects unsupported spec %s without printing it", (spec) => {
    const dependencies = { n3: spec, "@jeswr/storage-client": spec };
    const restrictedKeys = {
      "@jeswr/storage-client": spec,
      "@jeswr/pod-auth": spec,
      "@sparq-org/sparq": spec,
      "@sparq-org/sparq/wasm-node": spec,
      "@jeswr/storage-client/solid": spec,
      "@jeswr/storage-client/lws": spec,
    };
    const manifests = {
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        ...Object.fromEntries(fields.map((field) => [field, dependencies])),
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        ...Object.fromEntries(fields.map((field) => [field, dependencies])),
      },
      ...Object.fromEntries(
        [
          "packages/example/package.json",
          "apps/example/package.json",
          "apps/example/web/package.json",
          "tools/example/package.json",
        ].map((path) => [path, Object.fromEntries(fields.map((field) => [field, restrictedKeys]))]),
      ),
    };
    const result = scan(manifests);
    expect(result.status).toBe(1);
    for (const [path, manifest] of Object.entries(manifests)) {
      for (const field of fields) {
        for (const name of Object.keys(manifest[field])) {
          expect(result.stderr).toContain(
            `${path} ${field}.${name}: unsupported dependency spec for a layered package`,
          );
        }
      }
    }
    if (typeof spec === "string" && spec.trim()) expect(result.stderr).not.toContain(spec);
    expect(result.stderr).not.toContain("alias of");
  });

  it.each(unsupportedSpecs)("ignores unrelated spec %s in unrestricted manifests", (spec) => {
    const result = scan({
      "packages/example/package.json": {
        name: "@jeswr/example",
        dependencies: { unrelated: spec },
      },
      "apps/example/package.json": { peerDependencies: { unrelated: spec } },
      "apps/example/web/package.json": { optionalDependencies: { unrelated: spec } },
      "tools/example/package.json": { dependencies: { unrelated: spec } },
    });
    expect(result.status).toBe(0);
  });

  it("leaves development dependencies outside the guard", () => {
    const result = scan({
      "apps/example/package.json": {
        devDependencies: { "@sparq-org/sparq": "npm:n3@*" },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        devDependencies: { storage: "workspace:../storage-client" },
      },
    });
    expect(result.status).toBe(0);
  });
});
