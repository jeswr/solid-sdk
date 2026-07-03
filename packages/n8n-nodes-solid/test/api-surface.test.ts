// AUTHORED-BY Claude Fable 5
//
// PUBLIC API SNAPSHOT — the reviewability cornerstone for this package.
//
// n8n-nodes-solid has THREE public surfaces, and "what is the API?" should be a
// one-file diff, not a code-reading exercise:
//   1. the importable pure-logic library (`src/index` — the package `main`);
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

import { describe, expect, it } from "vitest";
import { SolidApi } from "../credentials/SolidApi.credentials.js";
import { Solid } from "../nodes/Solid/Solid.node.js";
import * as lib from "../src/index.js";

describe("public API surface (committed snapshot — one-file diff)", () => {
  it("importable library exports (the package `main`)", () => {
    // Names + typeof only: signatures live in the committed dist/src/*.d.ts.
    const shape = Object.fromEntries(
      Object.keys(lib)
        .sort()
        .map((k) => [k, typeof (lib as Record<string, unknown>)[k]]),
    );
    expect(shape).toMatchSnapshot();
  });

  it("n8n INodeType description (resource/operation/parameter tree)", () => {
    const d = new Solid().description;
    // Project to the loader-relevant, stable fields — a change here is a change
    // to what the n8n UI shows and what a workflow can set.
    const projected = {
      name: d.name,
      displayName: d.displayName,
      version: d.version,
      usableAsTool: d.usableAsTool,
      credentials: d.credentials,
      inputs: d.inputs,
      outputs: d.outputs,
      properties: d.properties.map((p) => ({
        name: p.name,
        displayName: p.displayName,
        type: p.type,
        default: p.default,
        required: p.required ?? false,
        displayOptions: p.displayOptions ?? null,
        options: Array.isArray(p.options)
          ? (p.options as { value?: unknown }[]).map((o) => o.value ?? o)
          : undefined,
      })),
    };
    expect(projected).toMatchSnapshot();
  });

  it("n8n ICredentialType (credential shape + token injection)", () => {
    const c = new SolidApi();
    const projected = {
      name: c.name,
      displayName: c.displayName,
      properties: c.properties.map((p) => ({
        name: p.name,
        displayName: p.displayName,
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
