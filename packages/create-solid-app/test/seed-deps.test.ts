// AUTHORED-BY Claude Opus 4.8
/**
 * seed-deps cache keying. The persistent --seed-pod dep cache must be keyed by a
 * hash of the dependency specs, so a CLI upgrade that BUMPS a spec (e.g. a new
 * @solid/community-server or jose version) lands in a FRESH dir and never
 * silently reuses the stale cached versions of an older spec set.
 */
import { afterEach, describe, expect, it } from "vitest";
import { SEED_DEP_SPECS, seedDepsCacheDir, seedDepsSpecHash } from "../src/seed-deps.ts";

// Two distinct spec sets: `specsA` is today's; `specsB` is a future CLI upgrade
// that bumps both versions.
const specsA = { "@solid/community-server": "8.0.0-alpha.3", jose: "^6.2.3" };
const specsB = { "@solid/community-server": "9.0.0", jose: "^6.3.0" };

describe("seedDepsSpecHash", () => {
  it("is deterministic and key-order independent for the same spec set", () => {
    expect(seedDepsSpecHash(specsA)).toBe(seedDepsSpecHash(specsA));
    // Reversed insertion order — the canonicalisation sorts, so the hash is identical.
    const reordered = { jose: "^6.2.3", "@solid/community-server": "8.0.0-alpha.3" };
    expect(seedDepsSpecHash(reordered)).toBe(seedDepsSpecHash(specsA));
  });

  it("differs when ANY spec changes (a bumped version => a new hash)", () => {
    expect(seedDepsSpecHash(specsA)).not.toBe(seedDepsSpecHash(specsB));
    // A single-dep bump is enough.
    const bumpJoseOnly = { ...specsA, jose: "^6.3.0" };
    expect(seedDepsSpecHash(specsA)).not.toBe(seedDepsSpecHash(bumpJoseOnly));
  });

  it("the live SEED_DEP_SPECS hash matches the default-argument hash", () => {
    expect(seedDepsSpecHash()).toBe(seedDepsSpecHash(SEED_DEP_SPECS));
  });
});

describe("seedDepsCacheDir is spec-keyed (no stale reuse across spec sets)", () => {
  const prev = process.env.CREATE_SOLID_APP_SEED_DEPS_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.CREATE_SOLID_APP_SEED_DEPS_DIR;
    else process.env.CREATE_SOLID_APP_SEED_DEPS_DIR = prev;
  });

  it("includes the current spec hash in the path", () => {
    process.env.CREATE_SOLID_APP_SEED_DEPS_DIR = "/tmp/csa-seed-deps-base";
    const dir = seedDepsCacheDir();
    expect(dir.startsWith("/tmp/csa-seed-deps-base")).toBe(true);
    // The hash of the LIVE specs is the leaf — so the cache is keyed by the spec set.
    expect(dir.endsWith(seedDepsSpecHash(SEED_DEP_SPECS))).toBe(true);
  });

  it("a cache built for spec set A is NOT the dir used for spec set B (fresh path => reinstall)", () => {
    // The cache dir's leaf segment IS the spec hash, so different spec sets =>
    // structurally different dirs. The cache for A cannot be reused for B — B
    // resolves to a path A never wrote to.
    expect(seedDepsSpecHash(specsA)).not.toBe(seedDepsSpecHash(specsB));

    // And the live dir's leaf is exactly the hash of whichever spec set is current,
    // proving the keying flows through to the resolved cache directory.
    process.env.CREATE_SOLID_APP_SEED_DEPS_DIR = "/tmp/csa-seed-deps-base";
    const liveLeaf = seedDepsCacheDir().split("/").pop();
    expect(liveLeaf).toBe(seedDepsSpecHash(SEED_DEP_SPECS));
  });
});
