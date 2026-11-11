// AUTHORED-BY Codex (GPT-6.1 Sol)
import { entities, type JourneyData, type PlaceData, type VisitData } from "./generated/model.js";

export type { JourneyData, PlaceData, VisitData };
export { entities };
export const PLACE_CLASS = "https://schema.org/Place";
export interface RecordValue<T> {
  url: string;
  etag: string | null;
  data: T;
}
export interface PlacesSnapshot {
  /** Unreadable, invalid or non-private files omitted by the last load. */
  skipped?: number;
  places: RecordValue<PlaceData>[];
  visits: RecordValue<VisitData>[];
  journeys: RecordValue<JourneyData>[];
}
/** Runtime build drops bad required values. Require a successful generated parse before writing. */
export function serializeRecord(kind: "Place", url: string, data: PlaceData): Promise<string>;
export function serializeRecord(kind: "Visit", url: string, data: VisitData): Promise<string>;
export function serializeRecord(kind: "Journey", url: string, data: JourneyData): Promise<string>;
export async function serializeRecord(
  kind: "Place" | "Visit" | "Journey",
  url: string,
  data: PlaceData | VisitData | JourneyData,
): Promise<string> {
  if (kind === "Place") {
    if (!entities.Place.parse(url, entities.Place.build(url, data as PlaceData)))
      throw new TypeError("Invalid place");
    return entities.Place.serialize(url, data as PlaceData);
  }
  const span = data as VisitData;
  // Cross-field ordering is domain policy beyond the generator's flat field constraints.
  if (!(span.startTime <= span.endTime)) throw new TypeError("End must follow start");
  if (kind === "Visit") {
    if (!entities.Visit.parse(url, entities.Visit.build(url, span)))
      throw new TypeError("Invalid visit");
    return entities.Visit.serialize(url, span);
  }
  if (!entities.Journey.parse(url, entities.Journey.build(url, data as JourneyData)))
    throw new TypeError("Invalid journey");
  return entities.Journey.serialize(url, data as JourneyData);
}
