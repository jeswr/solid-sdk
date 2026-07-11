// AUTHORED-BY Claude Fable 5
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bannerifyReadme,
  buildCommitMessage,
  compareDirs,
  listFilesRecursive,
  mirrorRepoFor,
  parseCliArgs,
  rewriteManifest,
} from "../scripts/mirror-publish.mjs";

const FULL_SHA = "a".repeat(40);

describe("parseCliArgs", () => {
  it("defaults to dry-run", () => {
    const args = parseCliArgs(["solid-dpop"]);
    expect(args.pkg).toBe("solid-dpop");
    expect(args.execute).toBe(false);
    expect(args.depShas.size).toBe(0);
  });

  it("parses --execute and repeatable --dep-sha", () => {
    const args = parseCliArgs([
      "solid-openid-client",
      "--execute",
      "--dep-sha",
      `@jeswr/solid-dpop=${"b".repeat(40)}`,
      "--dep-sha",
      "solid-offline=abc1234",
    ]);
    expect(args.execute).toBe(true);
    expect(args.depShas.get("@jeswr/solid-dpop")).toBe("b".repeat(40));
    expect(args.depShas.get("solid-offline")).toBe("abc1234");
  });

  it("fails closed on unknown flags, missing pkg, malformed dep-sha, bad names", () => {
    expect(() => parseCliArgs(["pkg", "--force"])).toThrow(/unknown flag/);
    expect(() => parseCliArgs([])).toThrow(/usage/);
    expect(() => parseCliArgs(["pkg", "--dep-sha", "no-sha-here"])).toThrow(/--dep-sha expects/);
    expect(() => parseCliArgs(["pkg", "--dep-sha", "name=NOTHEX"])).toThrow(/--dep-sha expects/);
    expect(() => parseCliArgs(["../escape"])).toThrow(/invalid package dir name/);
    expect(() => parseCliArgs(["a", "b"])).toThrow(/unexpected extra argument/);
  });
});

describe("mirrorRepoFor", () => {
  it("strips the @jeswr scope and keeps unscoped names", () => {
    expect(mirrorRepoFor("@jeswr/solid-dpop")).toBe("jeswr/solid-dpop");
    expect(mirrorRepoFor("solid-offline")).toBe("jeswr/solid-offline");
    expect(mirrorRepoFor("n8n-nodes-solid")).toBe("jeswr/n8n-nodes-solid");
  });

  it("refuses foreign scopes (the @solid/ namespace rule)", () => {
    expect(() => mirrorRepoFor("@solid/object")).toThrow(/non-@jeswr/);
  });
});

describe("rewriteManifest", () => {
  const base = () => ({
    name: "@jeswr/solid-openid-client",
    version: "1.2.3",
    type: "module",
    exports: { ".": "./dist/index.js" },
    files: ["dist"],
    securityCritical: true,
    scripts: { build: "tsc", prepare: "evil" },
    devDependencies: { typescript: "^6.0.0" },
    mirrorPublish: { inlined: ["@jeswr/solid-dpop"] },
    dependencies: {
      "@jeswr/solid-dpop": "workspace:*",
      "@jeswr/fetch-rdf": "^0.1.0",
    },
    peerDependencies: { "openid-client": "^6.0.0" },
  });

  it("strips scripts/devDependencies/mirrorPublish and drops inlined workspace deps", () => {
    const out = rewriteManifest(base());
    expect(out.scripts).toBeUndefined();
    expect(out.devDependencies).toBeUndefined();
    expect(out.mirrorPublish).toBeUndefined();
    expect(out.dependencies["@jeswr/solid-dpop"]).toBeUndefined();
    // registry deps pass through untouched
    expect(out.dependencies["@jeswr/fetch-rdf"]).toBe("^0.1.0");
    expect(out.peerDependencies["openid-client"]).toBe("^6.0.0");
    // identity fields survive
    expect(out.securityCritical).toBe(true);
    expect(out.exports["."]).toBe("./dist/index.js");
    expect(out.version).toBe("1.2.3");
  });

  it("rewrites non-inlined workspace deps to github mirror pins", () => {
    const m = base();
    m.mirrorPublish = { inlined: [] };
    const sha = "c".repeat(40);
    const out = rewriteManifest(m, new Map([["@jeswr/solid-dpop", sha]]));
    expect(out.dependencies["@jeswr/solid-dpop"]).toBe(`github:jeswr/solid-dpop#${sha}`);
  });

  it("fails closed on a workspace dep that is neither inlined nor pinned", () => {
    const m = base();
    m.mirrorPublish = { inlined: [] };
    expect(() => rewriteManifest(m)).toThrow(/neither declared inlined .+ nor pinned/);
  });

  it("refuses private packages and inlined deps outside dependencies", () => {
    expect(() => rewriteManifest({ name: "x", private: true })).toThrow(/private/);
    const m = base();
    m.peerDependencies = { "@jeswr/solid-dpop": "workspace:*" };
    delete m.dependencies["@jeswr/solid-dpop"];
    expect(() => rewriteManifest(m)).toThrow(/must be a regular dependency/);
  });

  it("removes dependency maps that end up empty", () => {
    const m = {
      name: "@jeswr/leaf",
      version: "0.0.1",
      mirrorPublish: { inlined: ["@jeswr/guarded-fetch"] },
      dependencies: { "@jeswr/guarded-fetch": "workspace:*" },
    };
    const out = rewriteManifest(m);
    expect(out.dependencies).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const m = base();
    const snapshot = JSON.stringify(m);
    rewriteManifest(m);
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

describe("buildCommitMessage", () => {
  it("carries the Mirror-Of + provenance trailers", () => {
    const msg = buildCommitMessage("solid-dpop", FULL_SHA);
    expect(msg).toContain(
      `mirror(solid-dpop): publish from jeswr/solid-sdk@${FULL_SHA.slice(0, 12)}`,
    );
    expect(msg).toContain(`Mirror-Of: jeswr/solid-sdk@${FULL_SHA}`);
    expect(msg).toContain("Model: claude-fable-5");
    expect(msg).toContain("Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>");
  });

  it("rejects short shas", () => {
    expect(() => buildCommitMessage("solid-dpop", "abc123")).toThrow(/full 40-char sha/);
  });
});

describe("bannerifyReadme", () => {
  it("prepends the read-only-mirror banner exactly once", () => {
    const once = bannerifyReadme("# pkg\n", "@jeswr/solid-dpop");
    expect(once).toContain("Read-only mirror");
    expect(once).toContain("jeswr/solid-sdk");
    const twice = bannerifyReadme(once, "@jeswr/solid-dpop");
    expect(twice).toBe(once);
  });
});

describe("listFilesRecursive / compareDirs", () => {
  let dirs = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "mirror-test-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it("detects identical, missing, and differing files", () => {
    const a = tmp();
    const b = tmp();
    mkdirSync(join(a, "dist"), { recursive: true });
    mkdirSync(join(b, "dist"), { recursive: true });
    writeFileSync(join(a, "dist", "index.js"), "export {};\n");
    writeFileSync(join(b, "dist", "index.js"), "export {};\n");
    expect(compareDirs(a, b)).toEqual([]);
    expect(listFilesRecursive(a)).toEqual(["dist/index.js"]);

    writeFileSync(join(b, "dist", "extra.js"), "x");
    expect(compareDirs(a, b)).toEqual(["only in second: dist/extra.js"]);

    writeFileSync(join(b, "dist", "index.js"), "changed");
    rmSync(join(b, "dist", "extra.js"));
    expect(compareDirs(a, b)).toEqual(["content differs: dist/index.js"]);
  });
});
