// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
import { z } from "zod";

/** Passed to the later usePreferences('drive', schema) adapter; no persistence here. */
export const drivePreferencesSchema = z.object({
  starred: z.array(z.url({ protocol: /^https?$/ })).default([]),
  openedShared: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        name: z.string().optional(),
        type: z.enum(["file", "folder"]).optional(),
        openedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .default([]),
  view: z.enum(["list", "grid"]).default("list"),
  sort: z
    .object({
      key: z.enum(["name", "modified", "size"]),
      dir: z.enum(["asc", "desc"]),
    })
    .default({ key: "name", dir: "asc" }),
  columns: z.record(z.string(), z.number().positive()).default({}),
});

export type DrivePreferences = z.infer<typeof drivePreferencesSchema>;
