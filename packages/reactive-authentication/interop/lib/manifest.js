// The versioned target manifest: loading, validation and per-run configuration from the environment.
import { readdir, readFile } from "node:fs/promises";
import { registerSensitive } from "./redact.js";

export const manifestSchemaVersion = 1;

/**
 * Per adapter: its scenario ids and the capabilities every target must declare: `true`, `false` (known absence,
 * with a `capabilityNotes` reason; scenarios needing it are UNSUPPORTED) or `"unverified"` (not yet observed,
 * with a reason; scenarios needing it are UNTESTED — unknown behaviour never counts as unsupported).
 * Adapters assert that their scenario lists match (test/interop-harness.test.js).
 */
export const adapterSpecs = {
  "solid-oidc": {
    scenarios: [
      "solid.login",
      "solid.private-read",
      "solid.write",
      "solid.concurrency",
      "solid.boundary-explicit",
      "solid.boundary-automatic",
      "solid.refresh-restore",
      "solid.logout",
      "solid.cleanup",
    ],
    capabilities: ["refreshTokens", "refreshRotation", "revocation", "storageDiscovery"],
  },
  "oauth-code": {
    scenarios: [
      "oauth.login-api",
      "oauth.boundary",
      "oauth.refresh-restore",
      "oauth.expiry-renewal",
      "oauth.concurrent-refresh",
      "oauth.logout",
      "oauth.audience-mismatch",
    ],
    capabilities: [
      "refreshTokens",
      "refreshRotation",
      "revocation",
      "shortLivedTokens",
      "audienceRestriction",
    ],
  },
  "google-gis": {
    scenarios: ["gis.interaction-required", "gis.authorize-api", "gis.boundary", "gis.forget"],
    capabilities: ["revocation"],
  },
  "msal-browser": {
    scenarios: [
      "msal.interaction-required",
      "msal.authorize-api",
      "msal.silent-renewal",
      "msal.boundary",
      "msal.forget",
    ],
    capabilities: ["silentRenewal"],
  },
  "client-credentials": {
    scenarios: ["cc.token-write", "cc.private-read", "cc.boundary", "cc.forget", "cc.cleanup"],
    capabilities: [],
  },
  "solid-browser": {
    scenarios: [
      "browser.login-write",
      "browser.private-read",
      "browser.boundary",
      "browser.logout",
      "browser.cleanup",
    ],
    capabilities: [],
  },
  lws: {
    scenarios: [
      "lws.login-read",
      "lws.write",
      "lws.boundary",
      "lws.boundary-automatic",
      "lws.logout",
      "lws.cleanup",
    ],
    capabilities: ["writes", "storageDiscovery"],
  },
  "solid-uma": {
    scenarios: [
      "uma.login-read",
      "uma.private-read",
      "uma.write",
      "uma.boundary",
      "uma.logout",
      "uma.cleanup",
    ],
    capabilities: ["writes"],
  },
};
export const adapters = Object.keys(adapterSpecs);
export const capabilityValues = [true, false, "unverified"];
export const categories = ["local", "live"];
const sourceKinds = ["open", "closed", "service"];

/**
 * The manifest is split into fragments (`interop/targets/*.json`, each `{schemaVersion, targets}`) so that target
 * families are maintained separately; they are merged here and validated as one (ids must be unique overall).
 */
export async function loadManifest(directory = new URL("../targets/", import.meta.url)) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const fragments = await Promise.all(
    files.map(async (name) => ({
      name,
      ...JSON.parse(await readFile(new URL(name, directory), "utf8")),
    })),
  );
  const manifest = mergeFragments(fragments);
  const problems = validateManifest(manifest);
  if (problems.length > 0) throw new Error(`Invalid interop manifest:\n- ${problems.join("\n- ")}`);
  return manifest;
}

/** Merges manifest fragments; every fragment must declare the same schema version. */
export function mergeFragments(fragments) {
  const versions = new Set(fragments.map((f) => f.schemaVersion));
  return {
    schemaVersion: versions.size === 1 ? [...versions][0] : undefined,
    census: fragments.find((f) => f.census !== undefined)?.census,
    targets: fragments.flatMap((f) => (f.targets ?? []).map((t) => ({ ...t, fragment: f.name }))),
  };
}

/** Structural validation; returns problems (empty when valid). */
export function validateManifest(manifest) {
  const problems = [];
  if (manifest?.schemaVersion !== manifestSchemaVersion)
    problems.push(`schemaVersion must be ${manifestSchemaVersion}`);
  if (!Array.isArray(manifest?.targets)) return [...problems, "targets must be an array"];
  const ids = new Set();
  for (const [index, t] of manifest.targets.entries()) {
    const at = `targets[${index}]${typeof t?.id === "string" ? ` (${t.id})` : ""}`;
    if (typeof t?.id !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(t.id))
      problems.push(`${at}: id must be a lowercase slug`);
    if (ids.has(t?.id)) problems.push(`${at}: duplicate id`);
    ids.add(t?.id);
    if (typeof t?.name !== "string" || t.name === "") problems.push(`${at}: name is required`);
    if (!adapters.includes(t?.adapter))
      problems.push(`${at}: adapter must be one of ${adapters.join(", ")}`);
    if (!categories.includes(t?.category))
      problems.push(`${at}: category must be one of ${categories.join(", ")}`);
    if (typeof t?.software?.name !== "string" || !sourceKinds.includes(t?.software?.source))
      problems.push(
        `${at}: software.name and software.source (${sourceKinds.join("|")}) are required`,
      );
    if (t?.category === "local" && typeof t?.stack !== "string")
      problems.push(`${at}: local targets name their stack service`);
    if (!Array.isArray(t?.env)) problems.push(`${at}: env must be an array (possibly empty)`);
    for (const e of t?.env ?? []) {
      if (typeof e?.name !== "string" || !/^RA_INTEROP_[A-Z0-9_]+$/.test(e.name))
        problems.push(`${at}: env names must match RA_INTEROP_[A-Z0-9_]+`);
      if (typeof e?.description !== "string")
        problems.push(`${at}: env ${e?.name} needs a description`);
    }
    const spec = adapterSpecs[t?.adapter];
    if (typeof t?.capabilities !== "object" || t.capabilities === null)
      problems.push(`${at}: capabilities are required`);
    for (const name of spec?.capabilities ?? []) {
      if (!capabilityValues.includes(t?.capabilities?.[name]))
        problems.push(`${at}: capability ${name} must be declared true, false or "unverified"`);
    }
    for (const [name, value] of Object.entries(t?.capabilities ?? {})) {
      if (spec !== undefined && !spec.capabilities.includes(name))
        problems.push(`${at}: unknown capability ${name} for adapter ${t.adapter}`);
      if (!capabilityValues.includes(value))
        problems.push(`${at}: capability ${name} must be true, false or "unverified"`);
      if (
        value !== true &&
        !(
          typeof t?.capabilityNotes?.[name] === "string" &&
          t.capabilityNotes[name].trim().length >= 10
        )
      )
        problems.push(`${at}: capability ${name} is ${value} without a capabilityNotes reason`);
    }
    for (const [scenario, reason] of Object.entries(t?.unsupported ?? {})) {
      if (spec !== undefined && !spec.scenarios.includes(scenario))
        problems.push(`${at}: unsupported lists unknown scenario ${scenario}`);
      if (typeof reason !== "string" || reason.trim().length < 10)
        problems.push(`${at}: unsupported.${scenario} needs a reason`);
    }
    for (const [scenario, known] of Object.entries(t?.knownIncompatible ?? {})) {
      if (spec !== undefined && !spec.scenarios.includes(scenario))
        problems.push(`${at}: knownIncompatible lists unknown scenario ${scenario}`);
      if (typeof known?.reason !== "string" || known.reason.trim().length < 20)
        problems.push(`${at}: knownIncompatible.${scenario} needs a reason`);
      try {
        new RegExp(known?.signature);
        if (typeof known?.signature !== "string" || known.signature.length < 8) throw new Error();
      } catch {
        problems.push(`${at}: knownIncompatible.${scenario} needs a specific signature pattern`);
      }
    }
    if (t?.scenarios !== undefined) {
      if (!Array.isArray(t.scenarios) || t.scenarios.length === 0)
        problems.push(`${at}: scenarios must be a non-empty list when given`);
      for (const scenario of Array.isArray(t.scenarios) ? t.scenarios : []) {
        if (spec !== undefined && !spec.scenarios.includes(scenario))
          problems.push(`${at}: scenarios lists unknown scenario ${scenario}`);
      }
    }
    if (t?.blocked !== undefined && (typeof t.blocked !== "string" || t.blocked.length < 10))
      problems.push(`${at}: blocked must be a reason`);
    if (typeof t?.config !== "object" || t.config === null)
      problems.push(`${at}: config is required`);
    if (t?.category === "live" && JSON.stringify(t?.config ?? {}).includes('"insecure":true'))
      problems.push(`${at}: live targets must not opt in to insecure HTTP`);
    for (const value of stringsOf(t?.config ?? {})) {
      for (const [, name, fallback] of value.matchAll(/\$\{([A-Z0-9_]+)(:-[^}]*)?\}/g)) {
        if (!name.startsWith("RA_INTEROP_"))
          problems.push(`${at}: config references ${name}; only RA_INTEROP_ variables are allowed`);
        // Variables without defaults must be declared, so missing configuration is reported by name.
        else if (fallback === undefined && !(t.env ?? []).some((e) => e.name === name))
          problems.push(`${at}: config uses undeclared ${name}`);
      }
    }
  }
  return problems;
}

function* stringsOf(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringsOf(v);
  else if (value !== null && typeof value === "object")
    for (const v of Object.values(value)) yield* stringsOf(v);
}

/**
 * Resolves a target against the environment: `${NAME}` / `${NAME:-default}` in config strings. Values of
 * variables marked `secret` or `pii` are registered for redaction. Missing required variables make the target
 * unconfigured (reported UNTESTED by name, never by value).
 */
export function resolveTarget(target, env = process.env) {
  const missing = target.env.filter((e) => e.optional !== true && !env[e.name]).map((e) => e.name);
  for (const e of target.env)
    if ((e.secret || e.pii) && env[e.name]) registerSensitive(env[e.name]);
  const substitute = (value) =>
    value.replace(
      /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g,
      (_, name, fallback) => env[name] || fallback || "",
    );
  const resolve = (value) => {
    if (typeof value === "string") return substitute(value);
    if (Array.isArray(value)) return value.map(resolve);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .map(([k, v]) => [k, resolve(v)])
          .filter(([, v]) => v !== ""),
      );
    return value;
  };
  return {
    configured: missing.length === 0 && target.blocked === undefined,
    missing,
    config: resolve(target.config),
  };
}

export const suites = ["local", "live", "all"];

/** The scenario ids a target runs: its explicit list, or all of its adapter's. */
export function scenarioIdsOf(target) {
  return target.scenarios ?? adapterSpecs[target.adapter].scenarios;
}

/** Selects targets by suite/ids; unknown suites or ids are errors, and so is an empty selection. */
export function selectTargets(manifest, { suite, ids }) {
  if (suite !== undefined && !suites.includes(suite))
    throw new Error(`Unknown suite ${suite} (expected ${suites.join(", ")})`);
  let targets = manifest.targets;
  if (ids !== undefined && ids.length > 0) {
    const unknown = ids.filter((id) => !targets.some((t) => t.id === id));
    if (unknown.length > 0) throw new Error(`Unknown target(s): ${unknown.join(", ")}`);
    targets = targets.filter((t) => ids.includes(t.id));
  }
  if (suite !== undefined && suite !== "all") targets = targets.filter((t) => t.category === suite);
  if (targets.length === 0) throw new Error("The selection matches no targets");
  return targets;
}
