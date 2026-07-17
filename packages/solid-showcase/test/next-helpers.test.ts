// AUTHORED-BY Claude Fable 5
/** Deploy helpers under `@jeswr/solid-showcase/next`, driven only by the document. */
import { expect, test } from "vitest";
import { registeredApp } from "../src/index.js";
import {
  appVercelJson,
  envMatrix,
  healthRoute,
  showcaseMetadata,
  zoneRewrites,
} from "../src/next/index.js";
import { exampleWalkthrough } from "./support/example-document.js";

test("zoneRewrites with env UNSET falls back to unresolvable .invalid hosts", async () => {
  const rewrites = await zoneRewrites(exampleWalkthrough, { env: {} });
  // Three zone apps (vault, permits, outfitter) × two rules each; shell-local apps
  // (atlas, advisory) produce no rewrites.
  expect(rewrites).toHaveLength(6);
  expect(rewrites).toContainEqual({
    destination: "https://vault.invalid/vault",
    source: "/vault",
  });
  expect(rewrites).toContainEqual({
    destination: "https://vault.invalid/vault/:path+",
    source: "/vault/:path+",
  });
  expect(rewrites).toContainEqual({
    destination: "https://permits.invalid/permits",
    source: "/permits",
  });
  expect(rewrites).toContainEqual({
    destination: "https://outfitter.invalid/outfitter/:path+",
    source: "/outfitter/:path+",
  });
});

test("zoneRewrites with env SET routes both rules to the zone URL, trailing slash stripped", async () => {
  const rewrites = await zoneRewrites(exampleWalkthrough, {
    env: {
      TRAILS_OUTFITTER_ZONE_URL: "https://trails-outfitter.example.app",
      TRAILS_PERMITS_ZONE_URL: "https://trails-permits.example.app",
      TRAILS_VAULT_ZONE_URL: "https://trails-vault.example.app/",
    },
  });
  expect(rewrites).toContainEqual({
    destination: "https://trails-vault.example.app/vault",
    source: "/vault",
  });
  expect(rewrites).toContainEqual({
    destination: "https://trails-vault.example.app/vault/:path+",
    source: "/vault/:path+",
  });
  expect(rewrites).toContainEqual({
    destination: "https://trails-permits.example.app/permits/:path+",
    source: "/permits/:path+",
  });
});

test("zoneRewrites honours a custom fallback suffix", async () => {
  const rewrites = await zoneRewrites(exampleWalkthrough, { env: {}, fallbackSuffix: ".test" });
  expect(rewrites).toContainEqual({
    destination: "https://vault.test/vault",
    source: "/vault",
  });
});

test("envMatrix lists every zone URL var on the shell project", () => {
  const matrix = envMatrix(exampleWalkthrough);
  const zoneVars = matrix.filter((spec) => spec.name.endsWith("_ZONE_URL"));
  expect(zoneVars.map((spec) => spec.name).sort()).toEqual([
    "TRAILS_OUTFITTER_ZONE_URL",
    "TRAILS_PERMITS_ZONE_URL",
    "TRAILS_VAULT_ZONE_URL",
  ]);
  for (const spec of zoneVars) {
    expect(spec.apps).toEqual(["atlas"]);
    expect(spec.buildTime).toBe(true);
  }
});

test("envMatrix includes *_TRUST_FORWARDED_HEADERS for exactly the pod-route apps", () => {
  const matrix = envMatrix(exampleWalkthrough);
  const trust = matrix.find((spec) => spec.name === "TRAILS_TRUST_FORWARDED_HEADERS");
  expect(trust).toBeDefined();
  expect(trust?.value).toBe("1");
  // vault and permits declare podRoutes; outfitter/atlas/advisory do not.
  expect(trust?.apps.sort()).toEqual(["permits", "vault"]);
});

test("envMatrix omits the trust-headers var when no app declares pod routes", () => {
  const doc = structuredClone(exampleWalkthrough);
  for (const app of Object.values(doc.registry.apps)) {
    app.podRoutes = undefined;
  }
  expect(envMatrix(doc).some((spec) => spec.name.endsWith("_TRUST_FORWARDED_HEADERS"))).toBe(false);
});

test("appVercelJson pins the framework, turbo build filter, and turbo-ignore", () => {
  const vault = registeredApp(exampleWalkthrough.registry, "vault");
  expect(appVercelJson(vault, exampleWalkthrough)).toEqual({
    // biome-ignore lint/style/useNamingConvention: fixed vercel.json wire field
    $schema: "https://openapi.vercel.sh/vercel.json",
    buildCommand: "pnpm --dir ../.. exec turbo run build --filter=@trails/app-vault",
    framework: "nextjs",
    ignoreCommand: "npx turbo-ignore --fallback=HEAD^1",
  });
  expect(
    appVercelJson(vault, exampleWalkthrough, { packageName: "@acme/vault" }).buildCommand,
  ).toContain("--filter=@acme/vault");
});

test("healthRoute answers ok + service + simulated:true", async () => {
  const { GET } = healthRoute("atlas");
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, service: "atlas", simulated: true });
});

test("showcaseMetadata is the 'own'-variant demo metadata with noindex", () => {
  const metadata = showcaseMetadata(exampleWalkthrough);
  expect(metadata.title).toContain("Open Trails Walkthrough");
  expect(metadata.title).toContain("Concept Demo");
  expect(metadata.robots).toEqual({ follow: false, index: false });
  expect(metadata.description).toContain("Meridian Trails Collective");
});
