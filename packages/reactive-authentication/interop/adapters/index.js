// Adapter registry: each adapter validates a resolved target configuration (before any network request), turns
// it into scenarios and runs them.
import { browserCodeProvider, loginRecipes } from "../lib/browserLogin.js";
import { adapterSpecs, scenarioIdsOf } from "../lib/manifest.js";
import { runScenarios } from "../lib/scenario.js";
import { oauthScenarios, validateOAuthConfig } from "./oauth.js";
import { solidScenarios, validateSolidConfig } from "./solid.js";

/** A browser-backed CodeProvider factory for the target's login recipe and redirect URI. */
export function codeProviders(config, env) {
  const { recipe, ...parameters } = config.login ?? { recipe: "manual" };
  const login = loginRecipes[recipe];
  if (login === undefined) throw new Error(`Unknown login recipe ${recipe}`);
  // `fresh`: a new browser (context) — e.g. to start with the provider's consent rather than a remembered one.
  return ({ fresh = false } = {}) =>
    browserCodeProvider({
      context: fresh
        ? (() => {
            let opened;
            return async () => (opened ??= await env.freshContext());
          })()
        : env.context,
      redirectUri: config.redirectUri,
      login: login({ label: config.label ?? "the target", ...parameters }),
      timeoutMs: recipe === "manual" ? 300_000 : 90_000,
    });
}

/** Checks an adapter's scenarios against the manifest spec, then restricts them to the target's selection. */
export function selected(target, scenarios) {
  const ids = scenarios.map((s) => s.id);
  const spec = adapterSpecs[target.adapter].scenarios;
  if (ids.join() !== spec.join())
    throw new Error(
      `adapter ${target.adapter} scenarios (${ids.join(", ")}) differ from the manifest spec`,
    );
  const wanted = scenarioIdsOf(target);
  return scenarios.filter((s) => wanted.includes(s.id));
}

function fromValidation(problems) {
  if (problems.length > 0) throw new Error(`configuration error: ${problems.join("; ")}`);
}

async function execute(report, target, config, env, scenarios) {
  await runScenarios(
    report,
    target,
    selected(target, scenarios),
    {},
    { config, live: env.live, exerciseUnverified: env.exerciseUnverified, log: console.log },
  );
}

const registry = {
  "solid-oidc": {
    async run(report, target, config, env) {
      fromValidation(validateSolidConfig(config));
      await execute(
        report,
        target,
        config,
        env,
        solidScenarios(config, { ...env, codeProvider: codeProviders(config, env) }),
      );
    },
  },
  "oauth-code": {
    async run(report, target, config, env) {
      fromValidation(validateOAuthConfig(config));
      const { scenarios, close } = oauthScenarios(config, {
        ...env,
        codeProvider: codeProviders(config, env),
      });
      try {
        await execute(report, target, config, env, scenarios);
      } finally {
        await close();
      }
    },
  },
};

/** Adapters are loaded lazily so browser-SDK adapters (Google, MSAL) and LWS only load when selected. */
const lazy = {
  "google-gis": () => import("./google.js"),
  "msal-browser": () => import("./msal.js"),
  lws: () => import("./lws.js"),
  "solid-browser": () => import("./solidBrowser.js"),
  "client-credentials": () => import("./clientCredentials.js"),
  "solid-uma": () => import("./uma.js"),
};

export function adapterFor(name) {
  if (registry[name] !== undefined) return registry[name];
  if (lazy[name] !== undefined) {
    return {
      async run(report, target, config, env) {
        const { validate, scenarios, close } = await lazy[name]();
        fromValidation(validate(config, env));
        const built = await scenarios(config, env);
        try {
          await execute(report, target, config, env, built);
        } finally {
          await close?.(built);
        }
      },
    };
  }
  throw new Error(`Adapter ${name} is not implemented`);
}
