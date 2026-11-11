// AUTHORED-BY Codex GPT-6.1-Sol
import type { Literal } from "@rdfjs/types";
import { health, type ReadNode, S, TIME, XSD } from "./read.js";
import type { HealthPeriod } from "./types.js";

/** Calendar-checked parsing, with UTC for zone-less XSD values; lexical data is untouched. */
export function temporalTime(term: Literal): number | undefined {
  const rawKind = term.datatype.value.slice(XSD.length);
  const kind = rawKind === "dateTimeStamp" ? "dateTime" : rawKind;
  if (!term.datatype.value.startsWith(XSD)) return undefined;
  const patterns: Record<string, RegExp> = {
    date: /^(\d{4})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/,
    gYearMonth: /^(\d{4})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/,
    gYear: /^(\d{4})(Z|[+-]\d{2}:\d{2})?$/,
    dateTime:
      /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-4]):([0-5]\d):([0-5]\d)(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
  };
  const match = patterns[kind]?.exec(term.value);
  if (!match || (rawKind === "dateTimeStamp" && !match[8]) || match[0] !== term.value)
    return undefined;
  // XSD permits the next day's midnight as 24:00:00, with a zero fraction only.
  if (
    kind === "dateTime" &&
    match[4] === "24" &&
    (match[5] !== "00" || match[6] !== "00" || Number(match[7] ?? 0) !== 0)
  )
    return undefined;
  const year = Number(match[1]);
  const month = kind === "gYear" ? 1 : Number(match[2]);
  const day = kind === "gYear" || kind === "gYearMonth" ? 1 : Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] as number)) return undefined;
  const zone =
    kind === "dateTime"
      ? match[8]
      : kind === "date"
        ? match[4]
        : kind === "gYearMonth"
          ? match[3]
          : match[2];
  if (zone && zone !== "Z") {
    const hours = Number(zone.slice(1, 3)),
      minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return undefined;
  }
  const date = `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time =
    kind === "dateTime" ? `T${match[4]}:${match[5]}:${match[6]}${match[7] ?? ""}` : "T00:00:00";
  // Four-digit years, checked calendar/time fields and checked offsets are representable.
  return Date.parse(date + time + (zone ?? "Z"));
}
export function readPeriod(node: ReadNode): HealthPeriod {
  const start = node.literal(`${S}validFrom`),
    end = node.literal(`${S}validThrough`);
  return {
    start: start?.value,
    end: end?.value,
    startTime: start && temporalTime(start),
    endTime: end && temporalTime(end),
  };
}
/** Literal pilot dates and sector OWL-Time instants/interval beginnings. No unbounded walk. */
export function effectiveTime(node: ReadNode): { value?: string; time?: number } {
  let term = node.literal(...health("effectiveTime"));
  if (!term) {
    const temporal = node.child(...health("effectiveTime"));
    const instant = temporal?.child(`${TIME}hasBeginning`) ?? temporal;
    term = instant?.literal(
      `${TIME}inXSDDateTimeStamp`,
      `${TIME}inXSDDateTime`,
      `${TIME}inXSDDate`,
      `${TIME}inXSDgYearMonth`,
      `${TIME}inXSDgYear`,
    );
  }
  return { value: term?.value, time: term && temporalTime(term) };
}
