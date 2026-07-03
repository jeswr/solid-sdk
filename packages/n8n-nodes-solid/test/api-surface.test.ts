// AUTHORED-BY Claude Fable 5
//
// PUBLIC API SNAPSHOT — the reviewability cornerstone for this package.
//
// n8n-nodes-solid has THREE public surfaces, and "what is the API?" should be a
// one-file diff, not a code-reading exercise:
//   1. the importable pure-logic library (the package `main` — `dist/src/index`);
//   2. the n8n `INodeType` the community-node loader consumes (its description:
//      resource/operation/parameter tree the UI + workflows bind to);
//   3. the `ICredentialType` (the credential shape + how the token is injected).
//
// api-extractor (the suite's usual `etc/<pkg>.api.md` cornerstone) only sees
// MODULE exports — it would capture (1) but NOT the n8n runtime contracts (2)/(3),
// which are loaded via package.json's `n8n` field, not `exports`. And (1) is
// already exactly pinned by the committed `dist/src/index.d.ts` (diffable,
// check:dist-guarded) + the dist-load export-set assertion, so a new dev dep +
// its lockfile churn would be NET MORE to audit than it removes. So instead this
// test snapshots ALL THREE surfaces into one committed file
// (`test/__snapshots__/api-surface.test.ts.snap`): any change to the public
// contract shows up as a reviewable snapshot diff and must be intentional.
//
// IMPORTANT — this test loads the BUILT dist entrypoints, not the `src`/`nodes`
// TypeScript. n8n require()s the CommonJS dist (`package.json` `main` + the `n8n`
// field), and a GitHub-branch consumer imports the committed dist under
// `ignore-scripts=true`. Snapshotting `src` would validate the source, not what
// SHIPS; loading dist makes the snapshot the real public module surface and keeps
// it consistent with the `check:dist` freshness contract.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libJs = join(root, "dist", "src", "index.js");
const nodeJs = join(root, "dist", "nodes", "Solid", "Solid.node.js");
const credJs = join(root, "dist", "credentials", "SolidApi.credentials.js");
const require = createRequire(import.meta.url);

// n8n option metadata is UI-facing contract: a change to an option's display
// `name`/`description`/`action` (not just its `value`) changes what the operator
// sees. Snapshot all the stable UI-relevant fields, not just value.
interface NodeOption {
  name?: string;
  value?: unknown;
  description?: string;
  action?: string;
}
function projectOptions(options: unknown): unknown {
  if (!Array.isArray(options)) {
    return undefined;
  }
  return (options as NodeOption[]).map((o) => ({
    name: o.name ?? null,
    value: o.value ?? null,
    description: o.description ?? null,
    action: o.action ?? null,
  }));
}

beforeAll(() => {
  // Ensure the shipped dist exists (a clean checkout may not have built yet);
  // check:dist guards that the committed dist matches source.
  if (!existsSync(libJs) || !existsSync(nodeJs) || !existsSync(credJs)) {
    execFileSync("node", [join(root, "scripts", "build-dist.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
  }
}, 120_000);

describe("public API surface (committed snapshot — one-file diff, over the shipped dist)", () => {
  it("importable library exports (the package `main` = dist/src/index.js)", () => {
    // Load through the built CJS entry the loader/consumers actually use — not
    // the src. Names + typeof only: signatures live in committed dist/src/*.d.ts.
    const lib = require(libJs) as Record<string, unknown>;
    const shape = Object.fromEntries(
      Object.keys(lib)
        .sort()
        .map((k) => [k, typeof lib[k]]),
    );
    expect(shape).toMatchSnapshot();
  });

  it("n8n INodeType description (resource/operation/parameter tree)", () => {
    const mod = require(nodeJs) as {
      Solid: new () => { description: Record<string, unknown> };
    };
    const d = new mod.Solid().description as {
      name: string;
      displayName: string;
      version: number;
      usableAsTool?: boolean;
      credentials: unknown;
      inputs: unknown;
      outputs: unknown;
      properties: Array<{
        name: string;
        displayName: string;
        description?: string;
        type: string;
        default: unknown;
        required?: boolean;
        noDataExpression?: boolean;
        placeholder?: string;
        displayOptions?: unknown;
        options?: unknown;
      }>;
    };
    // Project to the loader-/UI-relevant, stable fields — a change here is a
    // change to what the n8n UI shows and what a workflow can set. Includes each
    // option's full UI metadata (name/value/description/action), not just value.
    const projected = {
      name: d.name,
      displayName: d.displayName,
      version: d.version,
      usableAsTool: d.usableAsTool ?? false,
      credentials: d.credentials,
      inputs: d.inputs,
      outputs: d.outputs,
      properties: d.properties.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description ?? null,
        type: p.type,
        default: p.default,
        required: p.required ?? false,
        noDataExpression: p.noDataExpression ?? false,
        placeholder: p.placeholder ?? null,
        displayOptions: p.displayOptions ?? null,
        options: projectOptions(p.options),
      })),
    };
    expect(projected).toMatchSnapshot();
  });

  it("n8n ICredentialType (credential shape + token injection)", () => {
    const mod = require(credJs) as {
      SolidApi: new () => {
        name: string;
        displayName: string;
        properties: Array<{
          name: string;
          displayName: string;
          description?: string;
          type: string;
          required?: boolean;
          typeOptions?: { password?: boolean };
        }>;
        authenticate: unknown;
      };
    };
    const c = new mod.SolidApi();
    const projected = {
      name: c.name,
      displayName: c.displayName,
      properties: c.properties.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        description: p.description ?? null,
        type: p.type,
        required: p.required ?? false,
        password: p.typeOptions?.password ?? false,
      })),
      // The token is injected as a Bearer header by n8n (node code never reads
      // it). Snapshot the injection contract so a change to it is deliberate.
      authenticate: c.authenticate,
    };
    expect(projected).toMatchSnapshot();
  });
});
