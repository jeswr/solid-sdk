// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recordToTurtle } from "@jeswr/agent-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewriteManifest } from "../../../scripts/mirror-publish.mjs";
import { descriptor, gmail } from "./fixtures/bindings.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

describe("published artifacts without workspace dependencies", () => {
  let directory: string;
  let mirror: { dependencies: Record<string, string> };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "agent-card-package-"));
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    mirror = rewriteManifest(manifest);
    await writeFile(join(directory, "package.json"), JSON.stringify(mirror));
    await cp(join(root, "dist"), join(directory, "dist"), { recursive: true });
    await mkdir(join(directory, "scripts"));
    await cp(join(root, "scripts/render-card.mjs"), join(directory, "scripts/render-card.mjs"));

    // Only published npm dependencies are available; suite package symlinks are absent.
    for (const name of [...Object.keys(mirror.dependencies), "@rdfjs/types"]) {
      expect(name).not.toMatch(/^@jeswr\//);
      const target = join(directory, "node_modules", name);
      await mkdir(dirname(target), { recursive: true });
      await symlink(join(root, "node_modules", name), target, "dir");
    }
    await writeFile(
      join(directory, "fixtures.json"),
      JSON.stringify({ descriptor, gmail, turtle: await recordToTurtle(gmail) }),
    );
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("omits every inlined workspace dependency from the mirror manifest", () => {
    expect(mirror.dependencies).not.toHaveProperty("@jeswr/agent-model");
    expect(mirror.dependencies).not.toHaveProperty("@jeswr/ldp-container");
    expect(Object.values(mirror.dependencies).every((spec) => !spec.startsWith("workspace:"))).toBe(
      true,
    );
  });

  it("loads, builds, and verifies cards with and without bindings in plain Node", async () => {
    await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describeAgent, verifyDescriptor } from './dist/index.js';
const { descriptor, gmail } = JSON.parse(await readFile('fixtures.json', 'utf8'));
assert.equal(describeAgent({ ...descriptor, bindings: undefined }).agentCard.capabilities, undefined);
const documents = describeAgent({ ...descriptor, bindings: [gmail] });
assert.deepEqual(documents.agentCard.capabilities.extensions[0].params.bindings, [gmail]);
const verified = await verifyDescriptor(descriptor.id, {
  body: await documents.agentDescription.toTurtle(), expectedId: descriptor.id,
});
assert.equal(verified.valid, true);
assert.deepEqual(verified.descriptor.bindings, [gmail]);
assert.throws(() => describeAgent({ ...descriptor, bindings: [{ ...gmail, credentialState: 'invalid' }] }));`,
      ],
      { cwd: directory },
    );
  });

  it("ships declarations that typecheck bindings without the private model or Zod", async () => {
    for (const file of await readdir(join(directory, "dist"), { recursive: true })) {
      if (file.endsWith(".d.ts")) {
        const declaration = await readFile(join(directory, "dist", file), "utf8");
        expect(declaration).not.toMatch(/["'](?:@jeswr\/|zod(?:\/|["']))/);
      }
    }
    await writeFile(
      join(directory, "consumer.mts"),
      `import { describeAgent, type AgentDescriptor } from './dist/index.js';
const descriptor: AgentDescriptor = ${JSON.stringify({ ...descriptor, bindings: [gmail] })};
describeAgent(descriptor);
describeAgent({ id: descriptor.id, name: descriptor.name });
type Binding = NonNullable<AgentDescriptor['bindings']>[number];
const binding: Binding = descriptor.bindings![0]!;
const state: 'none' | 'setup-required' | 'connected' | 'error' | 'disabled' = binding.credentialState;
const rate: number = binding.rateLimit.perRecipient;
const ingest: string | undefined = binding.lastIngest;
// @ts-expect-error Capability flags must retain their boolean type.
const invalidFlag: Binding = { ...binding, sendSupported: 'yes' };
// @ts-expect-error Connection states remain a closed union.
const invalidState: Binding = { ...binding, credentialState: 'invalid' };
// @ts-expect-error Required fields must remain required.
const incomplete: Binding = { type: 'channel-capability', id: binding.id };
void [state, rate, ingest, invalidFlag, invalidState, incomplete];
`,
    );
    await run(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        // Match the package's skipLibCheck: npm symlinks expose multiple Node type versions.
        // The import scan above still rejects unresolved private declaration dependencies.
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "consumer.mts",
      ],
      { cwd: directory },
    ).catch((error) => {
      throw new Error(error.stdout || error.stderr || error.message);
    });
  });

  it("runs the shipped renderer without private or workspace dependencies", async () => {
    await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderCard } from './scripts/render-card.mjs';
const { descriptor, gmail, turtle } = JSON.parse(await readFile('fixtures.json', 'utf8'));
const container = 'https://alice.example/agent/descriptors/';
const calls = [];
const documents = await renderCard(descriptor, container, async (url, init) => {
  calls.push(url);
  assert.equal(init.redirect, 'error');
  return new Response(url === container
    ? '<' + container + '> <http://www.w3.org/ns/ldp#contains> <gmail.ttl>.'
    : turtle, { headers: { 'content-type': 'text/turtle' } });
});
assert.deepEqual(calls, [container, container + 'gmail.ttl']);
assert.deepEqual(documents.agentCard.capabilities.extensions[0].params.bindings, [gmail]);`,
      ],
      { cwd: directory },
    );
  });
});
