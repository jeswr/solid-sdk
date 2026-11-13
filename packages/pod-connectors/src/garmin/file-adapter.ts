// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Garmin Connect → Health + Mobility (file import).
 *
 * Garmin is Tier B for OAuth (partner-program gated — see `adapter.ts`), but
 * users can already export their own data, so this file adapter complements
 * the OAuth path under the same catalog id — the connect page shows both. Two
 * legacy activity export shapes remain supported alongside the full account ZIP:
 *
 * 1. **Activities.csv** — Garmin Connect → Activities
 *    (connect.garmin.com/modern/activities) → "Export CSV". One summary row
 *    per activity: `Activity Type, Date, Favorite, Title, Distance, Calories,
 *    Time, …` (~35–50 columns; we read the stable leading ones). Note Garmin
 *    only exports the rows currently loaded in the list — scroll to the end
 *    first for full history.
 * 2. **A single GPX or TCX file** — the per-activity export on an activity
 *    page. TCX carries summary laps (time/distance/calories); GPX carries only
 *    the track, so we derive distance (haversine over trackpoints) and
 *    duration (first→last point time) and never invent calories.
 *
 * The recommended full account ZIP is detected by its entries and imported by
 * archive.ts, reusing Takeout's streaming ZIP validation and the bounded JSON reader.
 *
 * Normalisation follows the catalog's vocabulary map (Strava precedent):
 * runs/workouts → `schema:ExerciseAction` (Health); rides/commutes →
 * `schema:TravelAction` (Mobility). Distance/duration/date/calories go through
 * the typed vocab classes — never hand-built triples. The CSV's `Distance`
 * column is in the account's display unit, which the file does not state, so
 * we keep the bare value rather than invent a unit.
 */
import { DataFactory, Store } from "n3";
import { parseCsv } from "../core/csv.js";
import { isoDurationFromSeconds } from "../core/duration.js";
import type {
  FileImportAdapter,
  FileImportContext,
  FileImportOutcome,
  ImportFile,
} from "../core/file-import.js";
import { extractBlocks, firstTagText } from "../core/mini-xml.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { type ActionThing, CLASSES, ExerciseAction, TravelAction } from "../core/vocab.js";
import { isTravelActivity } from "./activity-kind.js";
import {
  GARMIN_ARCHIVE_LIMITS,
  type GarminArchiveLimits,
  garminInput,
  importGarminArchive,
} from "./archive.js";
import { vocabMap } from "./vocab-map.js";

const ID = "garmin";

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Garmin",
  tier: "B", // the catalog entry is Tier B; this is its export-file path
  authKind: "export-file",
  scopes: [],
  categories: ["health", "mobility"],
  whatYouGet:
    "Your full Garmin export: activities, daily health summaries, sleep, overnight HRV and VO₂max. Workouts go into Health; rides and commutes into Mobility. Unsupported files and metrics are reported.",
  requirements: [],
};

/** Hosts may lower archive limits; defaults are hard ceilings for untrusted inputs. */
export function createGarminFileAdapter(
  options: Partial<GarminArchiveLimits> = {},
): FileImportAdapter {
  const limits = { ...GARMIN_ARCHIVE_LIMITS, ...options };
  for (const key of Object.keys(GARMIN_ARCHIVE_LIMITS) as (keyof GarminArchiveLimits)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > GARMIN_ARCHIVE_LIMITS[key]
    )
      throw new RangeError(`Invalid Garmin archive limit: ${key}`);
  }
  return {
    vocabMap,
    metadata,
    streaming: true,
    accept:
      ".zip,application/zip,.csv,.gpx,.tcx,text/csv,application/gpx+xml,application/vnd.garmin.tcx+xml",
    fileHint:
      'Recommended: Garmin Account → Data Management → "Export Your Data" and select the full downloaded ZIP; no need to unzip. Garmin Connect → Activities → "Export CSV" (load all rows first), or a single activity exported as GPX or TCX, also work. Nested FIT archives are handled by the activity-files adapter.',
    exportUrl: "https://www.garmin.com/account/datamanagement/",

    async importFile(file: ImportFile, ctx: FileImportContext): Promise<void | FileImportOutcome> {
      ctx.progress({ label: "Reading your Garmin export…", done: 0, total: 2 });
      const input = await garminInput(file, ctx.signal);
      if (input.zip) return importGarminArchive(file, ctx, limits);
      const text = input.text;

      const exercises = new Store();
      const journeys = new Store();
      const exDoc = ctx.resolve(EXERCISE_SLUG);
      const travelDoc = ctx.resolve(TRAVEL_SLUG);
      const sink: ActivitySink = { exercises, journeys, exDoc, travelDoc };

      const kind = detectShape(file.name, text);
      if (kind === "csv") parseActivitiesCsv(text, ctx.maxRows, sink);
      else if (kind === "gpx") parseGpx(text, ctx.maxRows, sink);
      else if (kind === "tcx") parseTcx(text, ctx.maxRows, sink);
      // Unknown shape writes nothing; the runner reports "nothing importable".

      ctx.progress({ label: "Saving to your pod…", done: 1, total: 2 });
      if (exercises.size > 0) {
        await ctx.write({
          slug: EXERCISE_SLUG,
          category: "health",
          forClass: CLASSES.ExerciseAction,
          dataset: exercises,
        });
      }
      if (journeys.size > 0) {
        await ctx.write({
          slug: TRAVEL_SLUG,
          category: "mobility",
          forClass: CLASSES.TravelAction,
          dataset: journeys,
        });
      }
      ctx.progress({ label: "Done", done: 2, total: 2 });
    },
  };
}

export const garminFileAdapter = createGarminFileAdapter();

/** Same doc slugs as the OAuth adapter: one Garmin container, either path. */
const EXERCISE_SLUG = "health/activities.ttl";
const TRAVEL_SLUG = "mobility/journeys.ttl";

interface ActivitySink {
  exercises: Store;
  journeys: Store;
  exDoc: string;
  travelDoc: string;
}

/** One normalised activity, whichever file shape it came from. */
interface Activity {
  name: string;
  type: string;
  start?: Date;
  /** ISO-8601 duration. */
  duration?: string;
  /** Human distance text ("5.43 km") or the bare CSV value (unit unstated). */
  distance?: string;
  /** Human energy text ("345 kcal"). */
  calories?: string;
}

/** Sniff which Garmin export shape this is (extension first, content second). */
export function detectShape(name: string, text: string): "csv" | "gpx" | "tcx" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".tcx")) return "tcx";
  const head = text.slice(0, 2048).replace(/^\uFEFF/, "");
  if (/<gpx[\s>]/i.test(head)) return "gpx";
  if (/<TrainingCenterDatabase[\s>]/i.test(head)) return "tcx";
  if (/^["']?Activity Type["']?\s*,/i.test(head)) return "csv";
  return "unknown";
}

export { isTravelActivity } from "./activity-kind.js";

/** Write one activity into the right store as the right typed class. */
function addActivity(a: Activity, sink: ActivitySink): void {
  const key = `${a.name}|${a.type}|${a.start?.toISOString() ?? ""}`;
  const frag = recordFragment(a.name, key);
  const travel = isTravelActivity(a.type);
  const action: ActionThing = travel
    ? new TravelAction(`${sink.travelDoc}#journey-${frag}`, sink.journeys, DataFactory).mark()
    : new ExerciseAction(`${sink.exDoc}#activity-${frag}`, sink.exercises, DataFactory).mark();
  action.name = a.name;
  if (a.start) action.startTime = a.start;
  if (a.duration) action.duration = a.duration;
  if (a.distance) action.distance = a.distance;
  if (a.calories) action.calories = a.calories;
  if (!travel && action instanceof ExerciseAction && a.type) {
    action.exerciseType = a.type;
  }
}

// ---------------------------------------------------------------------------
// Shape 1: Activities.csv ("Export CSV" on the activities list)
// ---------------------------------------------------------------------------

function parseActivitiesCsv(text: string, maxRows: number, sink: ActivitySink): void {
  const { rows } = parseCsv(text);
  let count = 0;
  for (const row of rows) {
    if (count >= maxRows) break;
    const type = (row["Activity Type"] ?? "").trim();
    const title = (row.Title ?? "").trim();
    if (!type && !title) continue; // not an activity row
    addActivity(
      {
        name: title || type || "Activity",
        type,
        start: parseGarminCsvDate(row.Date ?? ""),
        duration: parseClockDuration(row.Time ?? ""),
        // Garmin emits Distance in the account's display unit and the CSV
        // does not say which — keep the bare number, never invent a unit.
        distance: cleanNumber(row.Distance ?? ""),
        calories: formatCalories(row.Calories ?? ""),
      },
      sink,
    );
    count++;
  }
}

/** Garmin's `YYYY-MM-DD HH:MM:SS` (no offset stated — treat as UTC, the Fitbit precedent). */
export function parseGarminCsvDate(raw: string): Date | undefined {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** `hh:mm:ss(.f)` or `mm:ss` clock time → ISO-8601 duration; junk → undefined. */
export function parseClockDuration(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (!m) return undefined;
  const [, a, b, c] = m;
  const seconds =
    c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
  return isoDurationFromSeconds(seconds);
}

/** A strictly numeric cell (allowing `1,234.5`) → normalised text; else undefined. */
export function cleanNumber(raw: string): string | undefined {
  const t = raw.trim();
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(t)) return undefined;
  const n = Number.parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(n);
}

function formatCalories(raw: string): string | undefined {
  const n = cleanNumber(raw);
  return n === undefined ? undefined : `${n} kcal`;
}

// ---------------------------------------------------------------------------
// Shape 2a: a single-activity GPX export (track only — no summary fields)
// ---------------------------------------------------------------------------

function parseGpx(xml: string, maxPoints: number, sink: ActivitySink): void {
  for (const trk of extractBlocks(xml, "trk", 50)) {
    const name = firstTagText(trk.inner, "name") ?? "Garmin activity";
    const type = firstTagText(trk.inner, "type") ?? "";

    let first: Date | undefined;
    let last: Date | undefined;
    let metres = 0;
    let prev: { lat: number; lon: number } | undefined;
    let points = 0;
    for (const pt of extractBlocks(trk.inner, "trkpt", maxPoints)) {
      points++;
      const when = parseIsoDate(firstTagText(pt.inner, "time"));
      if (when) {
        first ??= when;
        last = when;
      }
      const lat = Number.parseFloat(pt.attrs.lat ?? "");
      const lon = Number.parseFloat(pt.attrs.lon ?? "");
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      ) {
        if (prev) metres += haversineMetres(prev.lat, prev.lon, lat, lon);
        prev = { lat, lon };
      }
    }
    if (points === 0) continue; // an empty <trk> is not an activity

    const start = first ?? parseIsoDate(firstTagText(xml, "time")); // metadata fallback
    const seconds = first && last ? (last.getTime() - first.getTime()) / 1000 : undefined;
    addActivity(
      {
        name,
        type,
        start,
        duration:
          seconds !== undefined && seconds > 0 ? isoDurationFromSeconds(seconds) : undefined,
        distance: metres > 0 ? `${(metres / 1000).toFixed(2)} km` : undefined,
        // GPX has no calories — never invent them.
      },
      sink,
    );
  }
}

// ---------------------------------------------------------------------------
// Shape 2b: a single-activity TCX export (summary laps)
// ---------------------------------------------------------------------------

function parseTcx(xml: string, maxRows: number, sink: ActivitySink): void {
  for (const activity of extractBlocks(xml, "Activity", maxRows)) {
    const sport = activity.attrs.Sport ?? "";
    const id = firstTagText(activity.inner, "Id");
    let seconds = 0;
    let metres = 0;
    let kcal = 0;
    for (const lap of extractBlocks(activity.inner, "Lap", maxRows)) {
      // Lap summary fields precede <Track>; cut it off so trackpoint
      // DistanceMeters/Calories can never shadow the lap totals.
      const summary = lap.inner.split(/<Track[\s>]/)[0] ?? "";
      seconds += positiveFloat(firstTagText(summary, "TotalTimeSeconds")) ?? 0;
      metres += positiveFloat(firstTagText(summary, "DistanceMeters")) ?? 0;
      kcal += positiveFloat(firstTagText(summary, "Calories")) ?? 0;
    }
    addActivity(
      {
        name:
          firstTagText(activity.inner, "Name") ?? (sport ? `Garmin ${sport}` : "Garmin activity"),
        type: sport,
        start: parseIsoDate(id),
        duration: seconds > 0 ? isoDurationFromSeconds(seconds) : undefined,
        distance: metres > 0 ? `${(metres / 1000).toFixed(2)} km` : undefined,
        calories: kcal > 0 ? `${Math.round(kcal)} kcal` : undefined,
      },
      sink,
    );
  }
}

// ---------------------------------------------------------------------------

function parseIsoDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw.trim())) return undefined;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function positiveFloat(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Great-circle distance between two WGS-84 points, in metres. */
function haversineMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
