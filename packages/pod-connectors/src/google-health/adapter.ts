// AUTHORED-BY Codex GPT-6.1-Sol
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { RunBudget, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import type { IntegrationAdapter } from "../core/types.js";
import {
  DEFAULT_LIMITS,
  fetchPoints,
  GOOGLE_HEALTH_SCOPES,
  type HealthPoint,
  type HealthType,
  ID,
  record,
  summary,
  TYPES,
  timestamp,
} from "./api.js";
import { GOOGLE_HEALTH_FIXTURES } from "./fixtures.js";
import { healthDocuments } from "./mapping.js";
import { createGoogleHealthSourceAuth } from "./source-auth.js";
import { vocabMap } from "./vocab-map.js";

export interface GoogleHealthOptions {
  readonly limits?: RunLimits;
  readonly maxPages?: number;
  readonly now?: () => Date;
}

/** Google Health successor; the standard writer retains the legacy Fitbit container. */
export function createGoogleHealthAdapter({
  limits = DEFAULT_LIMITS,
  maxPages = 100,
  now = () => new Date(),
}: GoogleHealthOptions = {}): IntegrationAdapter {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new TypeError("maxPages must be between 1 and 100.");
  for (const n of [limits.maxRequests, limits.maxItems, limits.maxBytes ?? DEFAULT_LIMITS.maxBytes])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new TypeError("Run limits must be positive safe integers.");
  const runLimits = { ...limits, maxBytes: limits.maxBytes ?? DEFAULT_LIMITS.maxBytes };
  return {
    vocabMap,
    metadata: {
      id: ID,
      name: "Google Health",
      tier: "B",
      authKind: "oauth-pkce",
      scopes: GOOGLE_HEALTH_SCOPES,
      categories: ["health"],
      whatYouGet:
        "Exercise, daily activity, sleep, heart rate and weight saved into Health. Re-authorize to replace a legacy Fitbit connection.",
      requirements: [
        "Google Health Restricted scopes require Google verification and security review for public use; an owner's test-user project may connect privately.",
        "Enable Google Health API in your Google OAuth project and confirm its requested read scopes before configuring a live connection.",
        "Browser hosts inject a Web client id and TOKEN_PROXY; Node hosts use a Desktop client and loopback PKCE. Legacy Fitbit tokens cannot be reused.",
      ],
    },
    oauth: createGoogleOAuthConfig("health"),
    createSourceAuth: (config, token, fetch) =>
      createGoogleHealthSourceAuth({ config, token, fetch }),
    fixtures: () => GOOGLE_HEALTH_FIXTURES,
    async import(ctx) {
      if (ctx.scopes && GOOGLE_HEALTH_SCOPES.some((scope) => !ctx.scopes?.includes(scope)))
        throw new IntegrationSyncError(
          ID,
          "Re-authorize Google Health with all requested read permissions.",
        );
      const until = now().toISOString();
      const cursors = parseCursor(ctx.cursor, until);
      const next: Partial<Record<HealthType, string>> = { ...cursors };
      const budget = new RunBudget(ID, runLimits);
      const points: HealthPoint[] = [];
      let skipped = 0;
      for (const [i, type] of TYPES.entries()) {
        ctx.signal?.throwIfAborted();
        ctx.progress({ label: `Reading Health ${type}…`, done: i, total: TYPES.length });
        const batch = await fetchPoints(ctx, type, cursors[type], budget, maxPages, until);
        skipped += batch.skipped;
        // Never replace a complete daily total with a partially malformed day.
        if (!batch.skipped || !summary(type)) for (const p of batch.points) points.push(p);
        if (batch.latest) next[type] = batch.latest;
      }
      // All envelopes/pages/mappings must succeed before the first data write.
      const existing = points.some((p) => p.type === "exercise-session")
        ? await ctx.read("health/activities.ttl")
        : undefined;
      const docs = healthDocuments(points, (slug) => ctx.resolve(slug), existing);
      for (const doc of docs) await ctx.write(doc);
      ctx.progress({ label: "Done", done: TYPES.length, total: TYPES.length });
      return {
        cursor: JSON.stringify({ version: 1, cursors: next }),
        skipped: skipped || undefined,
      };
    },
  };
}

function parseCursor(
  value: string | undefined,
  until: string,
): Partial<Record<HealthType, string>> {
  if (!value) return {};
  try {
    if (value.length > 4096) throw new Error();
    const json: unknown = JSON.parse(value);
    if (
      !record(json) ||
      json.version !== 1 ||
      !record(json.cursors) ||
      Object.keys(json.cursors).some((key) => !TYPES.includes(key as HealthType))
    )
      throw new Error();
    const result: Partial<Record<HealthType, string>> = {};
    for (const type of TYPES) {
      if (json.cursors[type] === undefined) continue;
      const time = timestamp(json.cursors[type]);
      if (!time || time > until) throw new Error();
      result[type] = time;
    }
    return result;
  } catch {
    throw new IntegrationSyncError(ID, "Invalid Google Health checkpoint; start a full import.");
  }
}
export const googleHealthAdapter = createGoogleHealthAdapter();
