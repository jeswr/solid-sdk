// AUTHORED-BY Codex GPT-6.1-Sol
import { xmlEvents } from "../core/mini-xml.js";
import {
  Activity,
  type ActivityBudget,
  ActivityCap,
  numeric,
  type Point,
  sport,
  timestamp,
} from "./model.js";

/** Parse only the root-selected format; unrelated XML cannot masquerade as a track. */
export async function* xmlActivities(
  chunks: AsyncIterable<string>,
  budget: ActivityBudget,
): AsyncGenerator<Activity> {
  const stack: string[] = [];
  let format = "";
  let creator: string | undefined;
  let activity: Activity | undefined;
  let point: Point | undefined;
  let segment = 0;
  let text = "";
  let lap:
    | { duration?: number; distance?: number; calories?: number; avgHr?: number; maxHr?: number }
    | undefined;
  let hasDuration = false,
    hasDistance = false,
    hasCalories = false;
  let lapDuration = 0,
    lapDistance = 0,
    lapCalories = 0,
    hrWeighted = 0,
    hrWeight = 0;
  try {
    for await (const event of xmlEvents(chunks)) {
      budget.message();
      if (event.kind === "start") {
        const parent = stack.at(-1);
        stack.push(event.name);
        text = "";
        if (stack.length === 1) {
          format = event.name;
          if (format !== "gpx" && format !== "TrainingCenterDatabase")
            throw new Error("Unsupported activity XML root.");
          if (
            format === "gpx" &&
            event.attrs.version &&
            !["1.0", "1.1"].includes(event.attrs.version)
          )
            throw new Error("Unsupported GPX version.");
          creator = event.attrs.creator;
        }
        if (
          (format === "gpx" && event.name === "trk" && parent === "gpx") ||
          (format === "TrainingCenterDatabase" &&
            event.name === "Activity" &&
            parent === "Activities")
        ) {
          if (activity) throw new Error("Nested activity.");
          budget.activity();
          activity = new Activity(budget);
          activity.summary = format === "TrainingCenterDatabase";
          activity.creator = creator;
          activity.sport = sport(event.attrs.Sport ?? "");
          lapDuration = lapDistance = lapCalories = hrWeighted = hrWeight = 0;
          hasDuration = hasDistance = hasCalories = false;
        }
        if (!activity) continue;
        if (event.name === "trkseg" && parent === "trk") segment++;
        if (event.name === "Lap" && parent === "Activity") {
          segment++;
          lap = {};
          activity.start ??= timestamp(event.attrs.StartTime);
        }
        if (
          (event.name === "trkpt" && parent === "trkseg") ||
          (event.name === "Trackpoint" && parent === "Track" && stack.includes("Lap"))
        ) {
          if (point) throw new Error("Nested trackpoint.");
          point = {
            segment,
            lat: numeric(event.attrs.lat, -90, 90),
            lon: numeric(event.attrs.lon, -180, 180),
          };
        }
      } else if (event.kind === "text") {
        // xmlEvents bounds each text node; also bound a leaf split by comments.
        if (text.length + event.text.length > 65536)
          throw new Error("Activity XML value limit exceeded.");
        text += event.text;
      } else {
        const name = event.name;
        const parent = stack.at(-2);
        const value = text.trim();
        if (activity) {
          if (point) {
            if (name === "time" || name === "Time") point.time = timestamp(value);
            if (name === "ele" || name === "AltitudeMeters")
              point.altitude = numeric(value, -2000, 100000);
            if (name === "LatitudeDegrees") point.lat = numeric(value, -90, 90);
            if (name === "LongitudeDegrees") point.lon = numeric(value, -180, 180);
            if (name === "hr" || (name === "Value" && parent === "HeartRateBpm"))
              point.hr = numeric(value, 1, 255);
            if (name === "cad" || name === "Cadence" || name === "RunCadence")
              point.cadence = numeric(value, 0, 1000);
            if (name === "atemp") point.temperature = numeric(value, -128, 127);
            if (name === "DistanceMeters") point.distance = numeric(value);
            if (name === "Speed") point.speed = numeric(value, 0, 1000);
            if (name === "Watts") point.power = numeric(value, 0, 65534);
            if (name === "trkpt" || name === "Trackpoint") {
              activity.point(point);
              point = undefined;
            }
          } else if (lap && parent === "Lap") {
            if (name === "TotalTimeSeconds") lap.duration = numeric(value);
            if (name === "DistanceMeters") lap.distance = numeric(value);
            if (name === "Calories") lap.calories = numeric(value);
          } else if (lap && name === "Value") {
            if (parent === "AverageHeartRateBpm") lap.avgHr = numeric(value, 1, 255);
            if (parent === "MaximumHeartRateBpm") lap.maxHr = numeric(value, 1, 255);
          }
          if (name === "Lap" && lap) {
            hasDuration ||= lap.duration !== undefined;
            hasDistance ||= lap.distance !== undefined;
            hasCalories ||= lap.calories !== undefined;
            lapDuration += lap.duration ?? 0;
            lapDistance += lap.distance ?? 0;
            lapCalories += lap.calories ?? 0;
            if (lap.avgHr !== undefined && lap.duration) {
              hrWeighted += lap.avgHr * lap.duration;
              hrWeight += lap.duration;
            }
            if (lap.maxHr !== undefined) activity.maxHr = Math.max(activity.maxHr ?? 0, lap.maxHr);
            lap = undefined;
          }
          if (parent === "trk") {
            if (name === "name") activity.name = value;
            if (name === "type") activity.sport = sport(value);
          }
          if (name === "Id" && parent === "Activity") activity.start = timestamp(value);
          if (name === "Name" && parent === "Creator") activity.creator = value;
          if (name === "UnitId" && parent === "Creator") activity.serial = value;
          if (
            (name === "trk" && format === "gpx") ||
            (name === "Activity" && format === "TrainingCenterDatabase")
          ) {
            if (hasDuration) activity.duration = lapDuration;
            if (hasDistance) activity.distance = lapDistance;
            if (hasCalories) activity.calories = lapCalories;
            if (hrWeight) activity.avgHr = hrWeighted / hrWeight;
            yield activity.finish();
            activity = undefined;
          }
        }
        stack.pop();
        text = "";
      }
    }
  } catch (error) {
    if (!(error instanceof ActivityCap)) throw error;
    if (activity?.records) {
      activity.truncated = true;
      yield activity.finish();
    }
  }
}
