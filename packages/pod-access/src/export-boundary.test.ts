// AUTHORED-BY Codex GPT-6
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { grant, policy } from "../test/helpers.js";
import type { Mode } from "./index.js";
import * as access from "./index.js";

const expectedModes: Mode[] = ["read", "append", "write", "control"];

// Native Node resolution exercises the built export map, including every declared subpath.
// A worker contains prototype mutations if a regression exposes a reader class.
function checkBuiltExports(check: string): Promise<void> {
  const script = `
      (async () => {
        const { default: assert } = await import("node:assert/strict");
        const { readFileSync } = await import("node:fs");
        const { workerData } = await import("node:worker_threads");
        const load = specifier => import(specifier);
        const { parseRdf } = await load("@jeswr/fetch-rdf");
        const access = await load("@jeswr/pod-access");
        const manifest = JSON.parse(readFileSync(new URL(workerData.manifestUrl), "utf8"));
        const entries = [];
        for (const subpath of Object.keys(manifest.exports)) {
          assert.ok(!subpath.includes("*"), "Enumerate wildcard exports before testing them");
          const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
          entries.push(await load(specifier));
        }
        ${check}
      })();
      //# sourceURL=pod-access-export-boundary.js
      `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(script, {
      eval: true,
      workerData: { manifestUrl: new URL("../package.json", import.meta.url).href },
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Export boundary worker exited with code ${code}`));
    });
  });
}

describe("public export boundary", () => {
  it.each(expectedModes)("preserves the %s proof after public modes mutation attempts", (mode) => {
    expect(Object.isFrozen(access.modes)).toBe(true);
    const attempts = [
      () => (access.modes as Mode[]).splice(0),
      () => (access.modes as Mode[]).push("read"),
      () => Object.assign(access.modes, { 0: "control" }),
      () => Object.assign(access.modes, { length: 0 }),
      () => Object.setPrototypeOf(access.modes, null),
    ];
    for (const mutate of attempts) {
      expect(mutate).toThrow(TypeError);
      expect(access.modes).toEqual(expectedModes);
      const denied = access.emptyPolicy();
      const wider = policy(grant(undefined, { modes: new Set([mode]) }));
      expect(() => access.assertNotWider(denied, wider)).toThrow(`widens ${mode} access`);
      expect(access.policiesEqual(denied, wider)).toBe(false);
      expect(access.policiesEqual(wider, denied)).toBe(false);
      expect(() => access.assertNotWider(wider, denied)).not.toThrow();
      expect(access.policiesEqual(wider, wider)).toBe(true);
      expect(access.readModes([access.modeIri(mode)])).toEqual(
        new Set(mode === "write" ? ["write", "append"] : [mode]),
      );
      expect(access.ownerPolicy("urn:owner").grants[0]?.modes).toEqual(new Set(expectedModes));
    }
  });

  it("exposes no reader or error classes from any built public entry", async () => {
    await checkBuiltExports(`
      assert.ok(entries.length > 0);
      for (const entry of entries) {
        assert.equal("RdfNode" in entry, false);
        assert.equal("PolicyTooComplex" in entry, false);
        for (const [name, value] of Object.entries(entry)) {
          if (typeof value !== "function") continue;
          assert.doesNotMatch(Function.prototype.toString.call(value), /^class\\b/, name);
          if (value.prototype)
            assert.deepEqual(Reflect.ownKeys(value.prototype), ["constructor"], name);
        }
      }
      for (const subpath of ["rdf", "systems/acp", "dist/rdf.js", "dist/systems/acp.js"])
        await assert.rejects(load(manifest.name + "/" + subpath), {
          code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
        });
      assert.equal(Object.isFrozen(access.modes), true);
      assert.throws(() => access.modes.splice(0), TypeError);
      for (const mode of ["read", "append", "write", "control"]) {
        const wider = access.ownerPolicy("urn:owner");
        wider.grants[0].modes = new Set([mode]);
        wider.grants[0].who = [[{ kind: "public" }]];
        assert.throws(() => access.assertNotWider(access.emptyPolicy(), wider),
          new RegExp("widens " + mode + " access"));
        assert.equal(access.policiesEqual(access.emptyPolicy(), wider), false);
        assert.equal(access.policiesEqual(wider, access.emptyPolicy()), false);
      }
    `);
  });

  it("preserves public WAC and ACP reads after mutating all reachable export prototypes", async () => {
    await checkBuiltExports(`
      const resource = "https://pod.example/file";
      const aclUrl = resource + ".acl";
      const acrUrl = resource + ".acr";
      const wac = await parseRdf(
        '<#public> a <' + access.ACL + 'Authorization>; <' + access.ACL + 'accessTo> <' + resource +
        '>; <' + access.ACL + 'agentClass> <' + access.FOAF + 'Agent>; <' + access.ACL + 'mode> <' +
        access.ACL + 'Read>.', "text/turtle", { baseIRI: aclUrl });
      const acpTurtle = (vocabulary) =>
        '<#acr> a <' + access.ACP + 'AccessControlResource>; <' + access.ACP + 'resource> <' +
        resource + '>; <' + access.ACP + 'accessControl> <#control>. ' +
        '<#control> <' + access.ACP + 'apply> <#policy>. ' +
        '<#policy> <' + access.ACP + 'allow> <' + vocabulary + 'Read>; <' + access.ACP +
        'allOf> <#matcher>. <#matcher> <' + access.ACP + 'agent> <' + access.ACP + 'PublicAgent>.';
      const css = await parseRdf(acpTurtle(access.ACL), "text/turtle", { baseIRI: acrUrl });
      const ess = await parseRdf(acpTurtle(access.ACP), "text/turtle", { baseIRI: acrUrl });
      const read = () => [false, true].flatMap(target => [
        access.readWac(wac, resource, aclUrl, "css", target),
        access.readAcp(css, resource, acrUrl, "css", target),
        access.readAcp(ess, resource, acrUrl, "ess", target),
      ]);
      const baseline = read();
      for (const policy of baseline) {
        assert.equal(policy.grants.length, 1);
        assert.deepEqual(policy.grants[0].who, [[{ kind: "public" }]]);
        assert.deepEqual(policy.grants[0].modes, new Set(["read"]));
        assert.deepEqual(policy.denials, []);
      }
      const checkReaders = () => {
        const policies = read();
        assert.deepEqual(policies, baseline);
        for (const policy of policies) {
          assert.throws(() => access.assertNotWider(access.emptyPolicy(), policy), /widens read/);
          assert.equal(access.policiesEqual(access.emptyPolicy(), policy), false);
        }
      };

      // Shared language built-ins are outside the documented boundary. Follow all other
      // own properties (including function .prototype) and inherited prototype chains.
      const builtins = new Set([Object, Function, Array, Object.prototype, Function.prototype,
        Array.prototype, Object.getPrototypeOf(async () => {})]);
      const reachable = new Set();
      function visit(value) {
        if (value === null || (typeof value !== "object" && typeof value !== "function") ||
            builtins.has(value) || reachable.has(value)) return;
        reachable.add(value);
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          visit(descriptor.value);
          visit(descriptor.get);
          visit(descriptor.set);
        }
        visit(Object.getPrototypeOf(value));
      }
      entries.forEach(visit);
      assert.ok(reachable.has(access.modes));
      assert.ok(reachable.has(access.readWac.prototype));
      assert.ok(reachable.has(access.readAcp.prototype));
      let mutations = 0;
      const poison = { iris: () => [], nodes: () => [], get value() { return "urn:poisoned"; } };
      for (const value of reachable) {
        const original = Object.getPrototypeOf(value);
        try {
          if (Reflect.setPrototypeOf(value, poison)) mutations++;
          checkReaders();
        } finally {
          assert.equal(Reflect.setPrototypeOf(value, original), true);
        }
        // Reproduce an inherited-getter attack without detaching the original chain.
        for (const key of ["value", "iris", "nodes"]) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          try {
            if (Reflect.defineProperty(value, key, {
              configurable: true,
              get: () => poison[key],
            })) mutations++;
            checkReaders();
          } finally {
            if (descriptor) Object.defineProperty(value, key, descriptor);
            else Reflect.deleteProperty(value, key);
          }
        }
      }
      assert.ok(mutations > 0, "Exercise mutable functions, prototypes and export objects");
      checkReaders();
    `);
  });
});
