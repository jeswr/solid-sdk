/**
 * Owner availability settings for a personal agent, as a file in the agent directory
 * (`availability.json`). The owner's dashboard WRITES it (atomically, 0600); the agent READS it
 * when it opens (`openAgent`) and applies it as an overlay on its synthetic calendar
 * (`SyntheticCalendar.overlay`). Apply/reload semantics: a running agent keeps the settings it
 * opened with; a change takes effect at the agent's next start. The dashboard never touches the
 * agent's own state (`state.json`), holds or keys.
 *
 * Fail closed: a present but unreadable/invalid file blocks ALL availability (no slot is free)
 * rather than falling back to "free".
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { iso } from "./core/schema.js";
import { type AvailabilityOverlay, isTimeZone } from "./domains/scheduling.js";

export const AVAILABILITY_FILE = "availability.json";
export const MAX_OVERLAY_BUSY = 2000;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const workingHoursSchema = z
  .strictObject({
    start: hhmm,
    end: hhmm,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  })
  .refine((w) => w.start < w.end, "working hours must end after they start");

export const availabilityFileSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().int().min(0),
  appliedAt: iso,
  source: z.literal("owner-dashboard"),
  timeZone: z.string().max(64).refine(isTimeZone, "unknown IANA time zone").optional(),
  workingHours: workingHoursSchema.optional(),
  // A busy period that does not end after it starts makes the whole file invalid (fail closed).
  busy: z
    .array(
      z
        .strictObject({ start: iso, end: iso })
        .refine(
          (s) => Date.parse(s.end) > Date.parse(s.start),
          "a busy period must end after it starts",
        ),
    )
    .max(MAX_OVERLAY_BUSY),
  blocked: z.strictObject({ reason: z.string().min(1).max(300) }).optional(),
  /** Which calendar receives synthetic holds: only the agent's own synthetic calendar exists. */
  bookingTarget: z.enum(["agent-synthetic", "none"]),
  /** Human-readable provenance: the authoritative sources that fed `busy` (labels only). */
  sources: z.array(z.string().max(120)).max(50),
});
export type AvailabilityFile = z.infer<typeof availabilityFileSchema>;

/** Read the agent's availability overlay; undefined when no owner settings were applied. */
export function readAvailabilityOverlay(dir: string): AvailabilityOverlay | undefined {
  const path = join(dir, AVAILABILITY_FILE);
  if (!existsSync(path)) return undefined;
  let parsed: AvailabilityFile;
  try {
    parsed = availabilityFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {
      revision: -1,
      busy: [],
      blocked: { reason: "the owner's availability settings could not be read (fails closed)" },
    };
  }
  return overlayFromFile(parsed);
}

/** The overlay a (valid) settings file means — the SAME conversion the agent applies at open. */
export function overlayFromFile(parsed: AvailabilityFile): AvailabilityOverlay {
  const blocked =
    parsed.blocked ??
    (parsed.bookingTarget === "none"
      ? { reason: "no calendar may receive bookings for this agent" }
      : undefined);
  return {
    revision: parsed.revision,
    ...(parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
    ...(parsed.workingHours ? { workingHours: parsed.workingHours } : {}),
    busy: parsed.busy,
    ...(blocked ? { blocked } : {}),
  };
}

/** Write the overlay atomically (temp file + rename), mode 0600. */
export function writeAvailabilityFile(dir: string, file: AvailabilityFile): void {
  const value = availabilityFileSchema.parse(file);
  const path = join(dir, AVAILABILITY_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
