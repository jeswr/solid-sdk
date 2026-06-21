// AUTHORED-BY Claude Opus 4.8
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeRepo, scaffold, toPackageName } from "../src/scaffold.ts";

describe("toPackageName", () => {
  it("lowercases and url-safes names", () => {
    expect(toPackageName("My Cool App")).toBe("my-cool-app");
    expect(toPackageName("Foo_Bar.baz")).toBe("foo_bar.baz");
    expect(toPackageName("  --weird--  ")).toBe("weird");
    expect(toPackageName("")).toBe("solid-app");
  });
});

describe("normalizeRepo", () => {
  it("accepts a bare owner/repo", () => {
    expect(normalizeRepo("jeswr/my-app")).toBe("jeswr/my-app");
  });
  it("strips a github URL + .git suffix", () => {
    expect(normalizeRepo("https://github.com/jeswr/my-app.git")).toBe("jeswr/my-app");
    expect(normalizeRepo("https://github.com/jeswr/my-app/")).toBe("jeswr/my-app");
    expect(normalizeRepo("git@github.com:jeswr/my-app.git")).toBe("jeswr/my-app");
    // `.git` BEHIND a trailing slash must still be stripped (slash-then-git order).
    expect(normalizeRepo("https://github.com/jeswr/my-app.git/")).toBe("jeswr/my-app");
  });
  it("rejects garbage (returns undefined so the placeholder stays)", () => {
    expect(normalizeRepo(undefined)).toBeUndefined();
    expect(normalizeRepo("")).toBeUndefined();
    expect(normalizeRepo("not-a-repo")).toBeUndefined();
    expect(normalizeRepo("a/b/c")).toBeUndefined();
    expect(normalizeRepo("bad repo/name")).toBeUndefined();
  });
});

describe("scaffold", () => {
  let workDir: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "csa-scaffold-"));
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      result = await scaffold({ targetDir: "my-app", appName: "My App" });
    } finally {
      process.chdir(prevCwd);
    }
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("copies the expected file tree (key files present)", () => {
    const expected = [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      "AGENTS.md",
      "README.md",
      "public/callback.html",
      "app/layout.tsx",
      "app/page.tsx",
      "app/providers.tsx",
      "components/solid/SolidAuthProvider.tsx",
      "components/solid/LoginPanel.tsx",
      "components/solid/ProfileCard.tsx",
      "lib/solid/profile.ts",
      "lib/solid/login-ux.ts",
      "lib/solid/login-result.ts",
      "lib/solid/webid-token-provider.ts",
      "scripts/dev.mjs",
      "tests/lib/profile.test.ts",
      "vitest.config.ts",
      "vercel.json",
    ];
    for (const f of expected) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("excludes build/dep artefacts", () => {
    expect(result.files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(result.files.some((f) => f.startsWith(".next/"))).toBe(false);
    expect(result.files).not.toContain("tsconfig.tsbuildinfo");
  });

  it("ships the template lockfile for a resolution-free first install", () => {
    // The dominant TTFS install cost is npm resolving a cold dependency graph; shipping the
    // committed lockfile removes that (measured ~13.9s → ~7.3s warm — dx/ttfs-benchmark.md).
    expect(result.files).toContain("package-lock.json");
  });

  it("ships the lockfile-transport recurrence guard (#78) into every scaffolded app", () => {
    // The guard is part of the new-repo checklist: every scaffolded app inherits a
    // `check:lockfile-transport` gate so a stray `npm install` cannot silently rewrite a
    // @jeswr github: dep back to the SSH transport (which breaks `npm ci` on Vercel/CI).
    expect(result.files).toContain("scripts/check-lockfile-transport.mjs");
  });

  it("hardens the scaffold with .npmrc ignore-scripts=true (supply-chain)", async () => {
    // The suite-wide supply-chain rule (`ignore-scripts=true`) must reach every
    // scaffolded app out of the box. The template ships it as the non-dotfile
    // `npmrc` shim (npm STRIPS a published `.npmrc`), renamed to `.npmrc` here.
    expect(result.files, "scaffold must contain .npmrc").toContain(".npmrc");
    // The non-dotfile shim must NOT be left behind — it is renamed, not copied.
    expect(result.files, "the npmrc shim must be renamed, not left").not.toContain("npmrc");
    const npmrc = await readFile(join(result.targetDir, ".npmrc"), "utf8");
    // Assert the actual config DIRECTIVE line (not the substring, which a comment also satisfies).
    expect(npmrc).toMatch(/^\s*ignore-scripts\s*=\s*true\s*$/m);
  });

  it("ships .gitignore into every scaffolded app (publish-safe shim)", async () => {
    // npm always STRIPS a nested `.gitignore` from a published tarball, so the
    // template ships it as the non-dotfile `gitignore` shim, renamed to `.gitignore`
    // here. Without this an `npm publish`ed scaffold would commit node_modules/.env/etc.
    expect(result.files, "scaffold must contain .gitignore").toContain(".gitignore");
    // The non-dotfile shim must NOT be left behind — it is renamed, not copied.
    expect(result.files, "the gitignore shim must be renamed, not left").not.toContain("gitignore");
    const gitignore = await readFile(join(result.targetDir, ".gitignore"), "utf8");
    // Assert real ignore-rule content lines (not a substring a comment could satisfy).
    expect(gitignore).toMatch(/^\s*\.env\*?\s*$/m);
    expect(gitignore).toMatch(/^\s*\/node_modules\s*$/m);
  });

  it("ships .env.example into every scaffolded app (publish-safe shim)", async () => {
    // The CLI's own root `.gitignore` `.env.*` rule excludes `template/.env.example`
    // from `npm pack`, so it ships as the non-dotfile `env.example` shim, renamed to
    // `.env.example` here. Without this a published scaffold has no env documentation.
    expect(result.files, "scaffold must contain .env.example").toContain(".env.example");
    // The non-dotfile shim must NOT be left behind — it is renamed, not copied.
    expect(result.files, "the env.example shim must be renamed, not left").not.toContain(
      "env.example",
    );
    const envExample = await readFile(join(result.targetDir, ".env.example"), "utf8");
    // Assert a real assignment line (not a mention in a comment).
    expect(envExample).toMatch(/^\s*NEXT_PUBLIC_DEV_POD\s*=/m);
  });

  it("substitutes the package.json name", async () => {
    const pkg = JSON.parse(await readFile(join(result.targetDir, "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("my-app");
  });

  it("generates a README titled with the app name", async () => {
    const readme = await readFile(join(result.targetDir, "README.md"), "utf8");
    expect(readme.startsWith("# My App")).toBe(true);
  });

  it("refuses a non-empty target dir", async () => {
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      await expect(scaffold({ targetDir: "my-app", appName: "X" })).rejects.toThrow(/not empty/);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("ships the baked-in app-shell wiring (header + config)", () => {
    for (const f of ["lib/app-shell-config.ts", "lib/app-version.ts", "components/AppHeader.tsx"]) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("ships the baked safe-form chrome (solid-elements + the #121/#78 guards)", () => {
    // The proven safe-form recipe (#121 tail): the lockfile-transport guard (#78),
    // the css-isolation regression guard (#121/#80), the solid-elements adoption
    // test, and the <jeswr-loading> intrinsic typing must all be copied into a scaffold.
    for (const f of [
      "scripts/check-lockfile-transport.mjs",
      "tests/css-isolation.test.ts",
      "tests/solid-elements.test.ts",
      "types/solid-elements.d.ts",
      "next.config.ts",
    ]) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("bakes the pinned suite chrome deps + wires the lockfile-transport lint", async () => {
    const pkg = JSON.parse(await readFile(join(result.targetDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    // app-shell + solid-elements are pinned git+https refs (keyless npm ci — #78).
    expect(pkg.dependencies["@jeswr/app-shell"]).toMatch(
      /^git\+https:\/\/github\.com\/jeswr\/app-shell\.git#/,
    );
    expect(pkg.dependencies["@jeswr/solid-elements"]).toMatch(
      /^git\+https:\/\/github\.com\/jeswr\/solid-elements\.git#/,
    );
    // lit + @lit/react are DIRECT deps so npm hoists ONE copy (the dedupe intent).
    expect(pkg.dependencies.lit).toBeDefined();
    expect(pkg.dependencies["@lit/react"]).toBeDefined();
    // The #78 guard is wired into lint.
    expect(pkg.scripts.lint).toContain("check:lockfile-transport");
    expect(pkg.scripts["check:lockfile-transport"]).toBe(
      "node scripts/check-lockfile-transport.mjs",
    );
  });

  it("bakes the safe-form host-button base into globals.css (not a leaky form)", async () => {
    const css = await readFile(join(result.targetDir, "app", "globals.css"), "utf8");
    // The proven zero-specificity scope is present...
    expect(css).toMatch(/button:where\(:not\(\[data-app-shell-control\]\)\)/);
    // ...and the leaky (0,1,1) bare form is NOT (the #121 regression).
    expect(css).not.toMatch(/button:not\(\[data-app-shell-control\]\)\s*[{:]/);
  });

  it("uses the raw <jeswr-loading> wait-state form on the home page", async () => {
    const page = await readFile(join(result.targetDir, "app", "page.tsx"), "utf8");
    // Registration via the side-effect import + the raw-attribute label form.
    expect(page).toContain('import "@jeswr/solid-elements/react"');
    expect(page).toMatch(/<jeswr-loading\s+label=/);
  });

  it("ships the @jeswr/solid-components data-bound example + its JSX typing", () => {
    // The declarative data layer: the worked example component + the intrinsic-element
    // typing for the custom tags (so they're usable in TSX with no @ts-expect-error).
    for (const f of ["components/solid/PodDataView.tsx", "types/solid-components.d.ts"]) {
      expect(result.files, `missing ${f}`).toContain(f);
    }
  });

  it("bakes @jeswr/solid-components as a pinned git+https dep (keyless npm ci — #78)", async () => {
    const pkg = JSON.parse(await readFile(join(result.targetDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@jeswr/solid-components"]).toMatch(
      /^git\+https:\/\/github\.com\/jeswr\/solid-components\.git#[0-9a-f]{40}$/,
    );
  });

  it("bakes @jeswr/guarded-fetch (solid-components' optional remote-SHACL peer) so next build resolves it", async () => {
    // @jeswr/solid-components dynamic-imports @jeswr/guarded-fetch for the SSRF-safe
    // `remote` SHACL-view source. Even though the default example never triggers that
    // path, the bundler (Turbopack/webpack) must be able to RESOLVE the import target
    // or `next build` fails "Module not found: @jeswr/guarded-fetch". Shipping it as a
    // pinned dep makes the whole solid-components surface build out of the box.
    const pkg = JSON.parse(await readFile(join(result.targetDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@jeswr/guarded-fetch"]).toMatch(
      /^git\+https:\/\/github\.com\/jeswr\/guarded-fetch\.git#[0-9a-f]{40}$/,
    );
  });

  it("the shipped lockfile resolves @jeswr/solid-components over git+https (not SSH)", async () => {
    const lock = JSON.parse(
      await readFile(join(result.targetDir, "package-lock.json"), "utf8"),
    ) as { packages: Record<string, { resolved?: string }> };
    const node = lock.packages["node_modules/@jeswr/solid-components"];
    expect(node, "solid-components missing from lockfile").toBeDefined();
    // Must be the HTTPS transport (the #78 guard) — npm rewrites it to SSH on install.
    expect(node?.resolved).toMatch(
      /^git\+https:\/\/github\.com\/jeswr\/solid-components\.git#[0-9a-f]{40}$/,
    );
  });

  it("wires the default <solid-view> data-bound element into PodDataView + the home page", async () => {
    const view = await readFile(
      join(result.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    // Registered via the side-effect import; renders the resolve-by-type composer by default.
    expect(view).toContain('import "@jeswr/solid-components"');
    expect(view).toMatch(/<solid-view\s+ref=\{seamRef\}\s+src=\{storage\}/);
    // The home page renders the example once signed in.
    const page = await readFile(join(result.targetDir, "app", "page.tsx"), "utf8");
    expect(page).toContain("PodDataView");
  });

  it("substitutes APP_NAME into lib/app-shell-config.ts", async () => {
    const config = await readFile(join(result.targetDir, "lib", "app-shell-config.ts"), "utf8");
    // The display name is baked in; the un-given repo keeps its placeholder token.
    expect(config).toContain('"My App"');
    expect(config).toContain("__CSA_REPO__");
    expect(config).not.toContain("__CSA_APP_NAME__");
  });
});

describe("scaffold with --repo", () => {
  let workDir: string;
  let result: Awaited<ReturnType<typeof scaffold>>;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "csa-repo-"));
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      result = await scaffold({
        targetDir: "repo-app",
        appName: "Repo App",
        repo: "https://github.com/jeswr/repo-app.git",
      });
    } finally {
      process.chdir(prevCwd);
    }
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("bakes the normalised repo into FEEDBACK_REPO", async () => {
    const config = await readFile(join(result.targetDir, "lib", "app-shell-config.ts"), "utf8");
    expect(config).toContain('"jeswr/repo-app"');
    expect(config).not.toContain("__CSA_REPO__");
    expect(config).not.toContain("__CSA_APP_NAME__");
  });
});

describe("scaffold with --data-model", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "csa-model-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function scaffoldModel(name: string, dataModel?: string) {
    const prevCwd = process.cwd();
    process.chdir(workDir);
    try {
      return await scaffold({ targetDir: name, appName: name, dataModel });
    } finally {
      process.chdir(prevCwd);
    }
  }

  it("swaps the bound element for a specific model (task → <jeswr-task-list>)", async () => {
    const r = await scaffoldModel("task-app", "task");
    const view = await readFile(
      join(r.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    // The chosen element replaces the default <solid-view> in the bound region.
    expect(view).toMatch(/<jeswr-task-list\s+ref=\{seamRef\}\s+src=\{storage\}/);
    expect(view).not.toMatch(/<solid-view\s+ref=\{seamRef\}/);
    // The sentinels survive (so the file remains re-substitutable / re-findable).
    expect(view).toContain("CSA:DATA-VIEW-EL:BEGIN");
    expect(view).toContain("CSA:DATA-VIEW-EL:END");
    // The description mentions the chosen element.
    expect(view).toContain("jeswr-task-list");
  });

  it("swaps for contact / bookmark / profile / collection models (with the right src)", async () => {
    // [model, tag, srcLocal] — a profile card binds the WebID PROFILE document, so it
    // must read `webId`, NOT the pod `storage` container (the roborev Medium fix).
    const cases: ReadonlyArray<[string, string, string]> = [
      ["contact", "jeswr-contact-list", "storage"],
      ["bookmark", "jeswr-bookmark-list", "storage"],
      ["profile", "jeswr-profile-card", "webId"],
      ["collection", "jeswr-collection", "storage"],
    ];
    for (const [model, tag, src] of cases) {
      const r = await scaffoldModel(`${model}-app`, model);
      const view = await readFile(
        join(r.targetDir, "components", "solid", "PodDataView.tsx"),
        "utf8",
      );
      expect(view, `${model} → <${tag} src={${src}}>`).toMatch(
        new RegExp(`<${tag}\\s+ref=\\{seamRef\\}\\s+src=\\{${src}\\}`),
      );
    }
  });

  it("the profile model binds the WebID profile doc (src={webId}), never the storage container", async () => {
    // Explicit guard for the roborev Medium: <jeswr-profile-card> reads a WebID
    // profile, so a profile scaffold must point at `webId` — pointing it at the pod
    // `storage` container would render the wrong resource.
    const r = await scaffoldModel("profile-src-app", "profile");
    const view = await readFile(
      join(r.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    expect(view).toMatch(/<jeswr-profile-card\s+ref=\{seamRef\}\s+src=\{webId\}/);
    expect(view).not.toMatch(/<jeswr-profile-card\s+ref=\{seamRef\}\s+src=\{storage\}/);
  });

  it("the default (solid-view) leaves the template element verbatim", async () => {
    const r = await scaffoldModel("default-app", "solid-view");
    const view = await readFile(
      join(r.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    expect(view).toMatch(/<solid-view\s+ref=\{seamRef\}\s+src=\{storage\}/);
  });

  it("an OMITTED dataModel defaults to <solid-view>", async () => {
    const r = await scaffoldModel("omitted-app");
    const view = await readFile(
      join(r.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    expect(view).toMatch(/<solid-view\s+ref=\{seamRef\}\s+src=\{storage\}/);
  });

  it("an UNKNOWN dataModel falls back to the template default (never a broken file)", async () => {
    // scaffold() is belt-and-braces: bin.ts validates the key first, but a bad value
    // reaching scaffold() must not corrupt the file — it leaves the default <solid-view>.
    const r = await scaffoldModel("bogus-app", "not-a-model");
    const view = await readFile(
      join(r.targetDir, "components", "solid", "PodDataView.tsx"),
      "utf8",
    );
    expect(view).toMatch(/<solid-view\s+ref=\{seamRef\}\s+src=\{storage\}/);
  });
});
