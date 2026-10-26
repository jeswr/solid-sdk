// AUTHORED-BY Codex GPT-6.1-Sol
import { SaxesParser } from "saxes";
import type { Measurement, MetricKind } from "./metrics.js";
import { validateMeasurement } from "./metrics.js";

const TYPES = new Map<string, MetricKind>([
  ["HKQuantityTypeIdentifierHeartRate", "heartRate"],
  ["HKQuantityTypeIdentifierStepCount", "steps"],
  ["HKQuantityTypeIdentifierBodyMass", "weight"],
  ["HKQuantityTypeIdentifierBloodPressureSystolic", "systolic"],
  ["HKQuantityTypeIdentifierBloodPressureDiastolic", "diastolic"],
  ["HKCategoryTypeIdentifierSleepAnalysis", "sleep"],
]);
/** Port of PM's timestamp normalization, anchored to reject trailing garbage. */
export function parseAppleDate(raw: string): Date {
  const normalized = raw
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/, "$1T$2$3:$4");
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid Apple Health date");
  return date;
}
function record(attributes: Record<string, string>, iri: string): Measurement | undefined {
  const kind = TYPES.get(attributes.type ?? "");
  if (kind === undefined) return undefined;
  const at = parseAppleDate(attributes.startDate ?? "");
  let value: number;
  if (kind === "sleep") {
    // Ignore in-bed/awake summaries to avoid double-counting asleep stages.
    if (
      !/^HKCategoryValueSleepAnalysisAsleep(?:Unspecified|Core|Deep|REM)?$/.test(
        attributes.value ?? "",
      )
    )
      return undefined;
    value = (parseAppleDate(attributes.endDate ?? "").getTime() - at.getTime()) / 1000;
  } else {
    if (!attributes.value?.trim()) throw new TypeError("Missing Apple Health value");
    value = Number(attributes.value);
    const unit = attributes.unit;
    if (kind === "weight" && unit === "lb") value *= 0.45359237;
    else if (kind === "weight" && unit === "g") value /= 1000;
    else if (
      !(
        (kind === "weight" && unit === "kg") ||
        (kind === "heartRate" && unit === "count/min") ||
        (kind === "steps" && unit === "count") ||
        ((kind === "systolic" || kind === "diastolic") && unit === "mmHg")
      )
    ) {
      throw new TypeError("Unsupported Apple Health unit");
    }
  }
  const result: Measurement = {
    iri,
    kind,
    at,
    value,
    source: attributes.sourceName?.trim() || "Apple Health",
  };
  validateMeasurement(result);
  return result;
}
/**
 * Stream extracted export.xml with backpressure between chunks. Only the current
 * chunk's observations are retained; callers choose whether to persist or collect.
 * saxes never resolves external entities. Apple's standard internal DTD is accepted.
 * IDs are provided by the caller; no random clock/global/network dependencies.
 */
export async function* importAppleHealth(
  chunks: AsyncIterable<string>,
  iriFor: (index: number) => string,
): AsyncGenerator<Measurement> {
  const parser = new SaxesParser();
  let index = 0;
  let root: string | undefined;
  let pending: Measurement[] = [];
  parser.on("opentag", (tag) => {
    root ??= tag.name;
    if (root !== "HealthData") throw new TypeError("Expected Apple Health HealthData root");
    if (tag.name === "Record") {
      const item = record(tag.attributes as Record<string, string>, iriFor(index));
      if (item !== undefined) {
        pending.push(item);
        index++;
      }
    }
  });
  for await (const chunk of chunks) {
    parser.write(chunk);
    yield* pending;
    pending = [];
  }
  parser.close();
}
