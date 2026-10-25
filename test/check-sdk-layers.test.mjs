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

  it("rejects npm aliases and sparq subpaths without printing dependency ranges", () => {
    const result = scan({
      "apps/example/package.json": {
        dependencies: { engine: "npm:@sparq-org/sparq@0.1.5", "@sparq-org/sparq/wasm-node": "*" },
      },
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { n3: "npm:@jeswr/pod-auth@0.1.0" },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        dependencies: { storage: "npm:@jeswr/storage-client@0.1.0" },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dependencies.engine (alias of @sparq-org/sparq)");
    expect(result.stderr).toContain("dependencies.@sparq-org/sparq/wasm-node");
    expect(result.stderr).toContain("dependencies.n3 (alias of @jeswr/pod-auth)");
    expect(result.stderr).toContain("dependencies.storage (alias of @jeswr/storage-client)");
    expect(result.stderr).not.toContain("npm:");
  });

  it.each([
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ])("rejects workspace aliases in %s using the resolved target", (field) => {
    const result = scan({
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        [field]: { storage: "workspace:@jeswr/storage-client@*" },
      },
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        [field]: { n3: "workspace:@jeswr/pod-auth" },
      },
      "apps/example/web/package.json": {
        [field]: { engine: "workspace:@sparq-org/sparq" },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${field}.storage (alias of @jeswr/storage-client)`);
    expect(result.stderr).toContain("pod-auth must not depend on storage-client");
    expect(result.stderr).toContain(`${field}.n3 (alias of @jeswr/pod-auth)`);
    expect(result.stderr).toContain("storage-client may depend only on");
    expect(result.stderr).toContain(`${field}.engine (alias of @sparq-org/sparq)`);
    expect(result.stderr).toContain("apps must use the protocol-neutral SDK surface");
  });

  it.each([
    "npm:n3@^1.0.0",
    "workspace:n3@*",
    "workspace:n3",
    "npm:@jeswr/fetch-rdf@^1.0.0",
    "workspace:@jeswr/fetch-rdf@^1.0.0",
    "workspace:@jeswr/fetch-rdf",
  ])("allows %s even under a forbidden dependency key", (spec) => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { "@jeswr/pod-auth": spec },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        peerDependencies: { "@jeswr/storage-client": spec },
      },
      "apps/example/package.json": {
        optionalDependencies: { "@sparq-org/sparq": spec },
      },
    });
    expect(result.status).toBe(0);
  });

  it.each([
    "workspace:*",
    "workspace:^",
    "workspace:~",
    "workspace:0.1.0",
    "workspace:^0.1.0",
    "workspace:~0.1.0",
    "workspace:>=0.1 <1",
    "workspace:1.0.0 - 2.0.0",
    "workspace:1.x || >=2.0.0 <3",
    "workspace:1.2.3-beta.1+build.5",
    "^1.0.0",
    ">=1.0.0 <2.0.0",
    "1.0.0 - 2.0.0",
    "latest",
    "next_build",
  ])("uses the dependency key for %s", (spec) => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { n3: spec },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        dependencies: { "@jeswr/storage-client": spec },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pod-auth must not depend on storage-client");
    expect(result.stderr).not.toContain("storage-client may depend only on");
    expect(result.stderr).not.toContain("unresolvable dependency alias");
  });

  it.each([
    "link:../storage-client",
    "file:../storage-client",
    "github:jeswr/storage-client#private-ref",
    "git+https://example.invalid/storage-client.git#private-ref",
    "https://example.invalid/storage-client.tgz?private-token",
    "git@github.com:jeswr/storage-client.git",
    "jeswr/storage-client",
    "../storage-client",
    "workspace:../storage-client",
    "npm:",
    "workspace:",
    "",
    null,
  ])("fails closed on unresolvable spec %s without printing it", (spec) => {
    const result = scan({
      "packages/storage-client/package.json": {
        name: "@jeswr/storage-client",
        dependencies: { n3: spec },
      },
      "packages/pod-auth/package.json": {
        name: "@jeswr/pod-auth",
        peerDependencies: { storage: spec },
      },
      "apps/example/package.json": {
        optionalDependencies: { "@sparq-org/sparq": spec },
      },
      "tools/example/package.json": {
        dependencies: { "@jeswr/pod-auth": spec },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "packages/storage-client/package.json dependencies.n3: unresolvable dependency alias",
    );
    expect(result.stderr).toContain("peerDependencies.storage: unresolvable dependency alias");
    expect(result.stderr).toContain(
      "optionalDependencies.@sparq-org/sparq: unresolvable dependency alias",
    );
    expect(result.stderr).toContain(
      "tools/example/package.json dependencies.@jeswr/pod-auth: unresolvable dependency alias",
    );
    if (spec) expect(result.stderr).not.toContain(spec);
  });

  it.each([
    "github:example/unrelated#private-ref",
    "file:../unrelated",
    "link:../unrelated",
  ])("ignores unrelated %s edges in unrestricted manifests", (spec) => {
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

  it.each([
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
  ])("rejects unresolved restricted package keys in %s", (field) => {
    const result = scan({
      "packages/example/package.json": {
        name: "@jeswr/example",
        [field]: {
          "@jeswr/storage-client": "github:jeswr/storage-client#private-ref",
          "@jeswr/pod-auth": "file:../pod-auth",
        },
      },
      "apps/example/web/package.json": {
        [field]: { "@jeswr/storage-client/solid": "file:../storage-client" },
      },
    });
    expect(result.status).toBe(1);
    for (const name of [
      "@jeswr/storage-client",
      "@jeswr/pod-auth",
      "@jeswr/storage-client/solid",
    ]) {
      expect(result.stderr).toContain(`${field}.${name}: unresolvable dependency alias`);
    }
    expect(result.stderr).not.toContain("github:");
    expect(result.stderr).not.toContain("file:");
  });

  it("leaves development dependencies outside the guard", () => {
    const result = scan({
      "apps/example/package.json": {
        devDependencies: { "@sparq-org/sparq": "0.1.5" },
      },
      "packages/pod-auth/package.json": { name: "@jeswr/pod-auth" },
    });
    expect(result.status).toBe(0);
  });
});
