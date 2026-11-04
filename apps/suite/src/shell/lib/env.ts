// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";

const https = z.url({ protocol: /^https$/ });
const capabilities = z.strictObject({
  selfRegistration: z.boolean().optional(),
  publicLinks: z.boolean().optional(),
  authenticatedAgentGrants: z.boolean().optional(),
  grantExpiry: z.boolean().optional(),
  grantPurpose: z.boolean().optional(),
  accessRequests: z.boolean().optional(),
  liveUpdates: z.boolean().optional(),
  serverSearch: z.boolean().optional(),
  notifyAgents: z.boolean().optional(),
});
const jsonCapabilities = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Expected a JSON capability object" });
      return z.NEVER;
    }
  })
  .pipe(capabilities);

export const suiteEnvSchema = z.object({
  NEXT_PUBLIC_SUITE_IDP: https.optional(),
  NEXT_PUBLIC_SUITE_IDP_NAME: z.string().trim().min(1).default("your provider"),
  NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL: https.optional(),
  NEXT_PUBLIC_SHOW_BACKLOG_APPS: z
    .enum(["0", "1"])
    .default("0")
    .transform((v) => v === "1"),
  NEXT_PUBLIC_SUITE_DEMO: z
    .enum(["0", "1"])
    .default("1")
    .transform((v) => v !== "0"),
  NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: z
    .string()
    .default("https://solidcommunity.net/,https://login.inrupt.com/,https://teamid.live/")
    .transform((value) => value.split(",").map((url) => url.trim()))
    .pipe(z.array(https).min(1)),
  SUITE_TEST_CAPS: jsonCapabilities.prefault("{}"),
});
export type SuiteEnv = z.output<typeof suiteEnvSchema>;

/** Strict pure parser; callers can distinguish invalid configuration without exposing its values. */
export class SuiteEnvError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`Invalid suite environment: ${fields.join(", ")}`);
    this.name = "SuiteEnvError";
    this.fields = fields;
  }
}
export function parseSuiteEnv(record: Record<string, unknown>): SuiteEnv {
  const result = suiteEnvSchema.safeParse(record);
  if (!result.success)
    throw new SuiteEnvError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return result.data;
}

/**
 * Capability overrides are a test hook: they are honoured only in an end-to-end run, which sets
 * SUITE_E2E=1 alongside them, so a stray SUITE_TEST_CAPS on a real deployment changes nothing.
 */
export function testCapsSource(env: {
  SUITE_E2E?: string | undefined;
  SUITE_TEST_CAPS?: string | undefined;
}): string | undefined {
  return env.SUITE_E2E === "1" ? env.SUITE_TEST_CAPS : undefined;
}

let cached: SuiteEnv | undefined;
/** Next replaces only literal public env references. Invalid fields fall back independently. */
export function suiteEnv(): SuiteEnv {
  if (cached) return cached;
  const record: Record<string, unknown> = {
    NEXT_PUBLIC_SUITE_IDP: process.env.NEXT_PUBLIC_SUITE_IDP,
    NEXT_PUBLIC_SUITE_IDP_NAME: process.env.NEXT_PUBLIC_SUITE_IDP_NAME,
    NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL: process.env.NEXT_PUBLIC_SUITE_IDP_ACCOUNT_URL,
    NEXT_PUBLIC_SHOW_BACKLOG_APPS: process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS,
    NEXT_PUBLIC_SUITE_DEMO: process.env.NEXT_PUBLIC_SUITE_DEMO,
    NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS: process.env.NEXT_PUBLIC_SUITE_KNOWN_PROVIDERS,
    SUITE_TEST_CAPS: testCapsSource({
      SUITE_E2E: process.env.SUITE_E2E,
      SUITE_TEST_CAPS: process.env.SUITE_TEST_CAPS,
    }),
  };
  const result = suiteEnvSchema.safeParse(record);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    console.warn(new SuiteEnvError(fields).message);
    for (const field of fields) delete record[field];
  }
  cached = parseSuiteEnv(record);
  return cached;
}
