// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";

export const preferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).catch("system"),
  density: z.enum(["comfortable", "compact"]).catch("comfortable"),
  fontScale: z.enum(["90", "100", "110"]).catch("100"),
  motion: z.enum(["system", "reduce"]).catch("system"),
  appColours: z.boolean().catch(true),
  startPage: z.enum(["/home", "/drive", "/docs", "/tasks", "/permissions"]).catch("/drive"),
  notifications: z
    .object({
      shared: z.boolean().catch(true),
      requests: z.boolean().catch(true),
      comments: z.boolean().catch(true),
      tasks: z.boolean().catch(true),
      conflicts: z.boolean().catch(true),
      storage: z.boolean().catch(true),
      system: z.boolean().catch(true),
    })
    .catch({
      shared: true,
      requests: true,
      comments: true,
      tasks: true,
      conflicts: true,
      storage: true,
      system: true,
    }),
  /** Per-account opt-in to desktop pop-ups; browser permission alone never turns them on. */
  desktop: z.boolean().catch(false),
  quietHours: z
    .object({
      enabled: z.boolean().catch(false),
      start: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
        .catch("22:00"),
      end: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
        .catch("08:00"),
    })
    .catch({ enabled: false, start: "22:00", end: "08:00" }),
  offline: z.boolean().catch(true),
  technicalDetails: z.boolean().catch(false),
  accountIds: z.boolean().catch(false),
  onboarding: z.enum(["not-started", "complete", "skipped"]).catch("not-started"),
});
export type Preferences = z.output<typeof preferencesSchema>;
export const defaultPreferences: Preferences = preferencesSchema.parse({});
export const preferencesKey = (accountId: string) => `suite.prefs.v1.${accountId}`;

/** Malformed fields fall back independently, preserving valid preferences. */
export function parsePreferences(raw: string | null): Preferences {
  try {
    return preferencesSchema.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return preferencesSchema.parse({});
  }
}

export function mergePreferences(current: Preferences, patch: unknown): Preferences {
  const values = z.record(z.string(), z.unknown()).safeParse(patch);
  if (!values.success) return preferencesSchema.parse(current);
  const object = values.data;
  const nested = (key: "notifications" | "quietHours") => {
    const value = z.record(z.string(), z.unknown()).safeParse(object[key]);
    return value.success ? { ...current[key], ...value.data } : current[key];
  };
  return preferencesSchema.parse({
    ...current,
    ...object,
    notifications: nested("notifications"),
    quietHours: nested("quietHours"),
  });
}
