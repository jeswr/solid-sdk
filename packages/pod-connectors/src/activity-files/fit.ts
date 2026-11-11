// AUTHORED-BY Codex GPT-6.1-Sol
/** Minimal FIT protocol decoder. All offsets are checked before DataView reads;
 * definitions have at most 255 standard and developer fields, 16 local slots.
 * Unknown messages/fields advance by their declared sizes, never by guessed types.
 */
import { Activity, type ActivityBudget, ActivityCap, type Point, sport } from "./model.js";

export function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}
interface Field {
  id: number;
  size: number;
  type: number;
}
interface Definition {
  global: number;
  little: boolean;
  fields: Field[];
  developer: number;
}
const EPOCH = Date.UTC(1989, 11, 31);
const SIZES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 1,
  3: 2,
  4: 2,
  5: 4,
  6: 4,
  8: 4,
  9: 8,
  10: 1,
  11: 2,
  12: 4,
  13: 1,
  14: 8,
  15: 8,
  16: 8,
};
const SPORTS: Record<number, string> = {
  0: "workout",
  1: "running",
  2: "cycling",
  5: "swimming",
  11: "walking",
  17: "hiking",
};
export function fitActivities(bytes: Uint8Array, budget: ActivityBudget): Activity[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = bytes[0] ?? 0;
  if (
    bytes.length < 14 ||
    (header !== 12 && header !== 14) ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== ".FIT" ||
    (bytes[1] as number) >> 4 > 2
  )
    throw new Error("Invalid FIT header.");
  const end = header + view.getUint32(4, true);
  if (end + 2 !== bytes.length) throw new Error("Truncated FIT file or invalid data size.");
  if (
    header === 14 &&
    view.getUint16(12, true) !== 0 &&
    fitCrc(bytes.subarray(0, 12)) !== view.getUint16(12, true)
  )
    throw new Error("Invalid FIT header CRC.");
  if (fitCrc(bytes.subarray(0, end)) !== view.getUint16(end, true))
    throw new Error("Invalid FIT CRC.");
  const definitions = new Map<number, Definition>();
  let offset = header;
  const take = (size: number): number => {
    if (offset + size > end) throw new Error("Truncated FIT message.");
    const start = offset;
    offset += size;
    return start;
  };
  const scalar = (field: Field, start: number, little: boolean): number | undefined => {
    const type = field.type & 31;
    if (field.size !== SIZES[type]) return undefined;
    let n: number;
    switch (type) {
      case 0:
      case 2:
      case 10:
      case 13:
        n = view.getUint8(start);
        break;
      case 1:
        n = view.getInt8(start);
        break;
      case 3:
        n = view.getInt16(start, little);
        break;
      case 4:
      case 11:
        n = view.getUint16(start, little);
        break;
      case 5:
        n = view.getInt32(start, little);
        break;
      case 6:
      case 12:
        n = view.getUint32(start, little);
        break;
      case 8:
        n = view.getFloat32(start, little);
        break;
      case 9:
        n = view.getFloat64(start, little);
        break;
      default:
        return undefined;
    }
    const invalid = [10, 11, 12].includes(type)
      ? 0
      : type === 1
        ? 127
        : type === 3
          ? 32767
          : type === 5
            ? 2147483647
            : field.size === 1
              ? 255
              : field.size === 2
                ? 65535
                : field.size === 4
                  ? 4294967295
                  : NaN;
    return Number.isFinite(n) && Math.abs(n) <= 1e12 && n !== invalid ? n : undefined;
  };
  const out: Activity[] = [];
  let activity: Activity | undefined;
  let serial: string | undefined;
  let creator: string | undefined;
  let previousTimestamp: number | undefined;
  let lapDistance = 0,
    lapElevation = 0,
    lapHr = 0,
    lapWeight = 0;
  const current = (): Activity => {
    if (!activity) {
      budget.activity();
      activity = new Activity(budget);
      lapDistance = lapElevation = lapHr = lapWeight = 0;
      activity.serial = serial;
      activity.creator = creator;
    }
    return activity;
  };
  try {
    while (offset < end) {
      budget.message();
      const h = bytes[take(1)] as number;
      const compressed = !!(h & 128);
      if (!compressed && (h & 16 || (!(h & 64) && h & 32)))
        throw new Error("Invalid FIT message header.");
      const local = compressed ? (h >> 5) & 3 : h & 15;
      if (!compressed && h & 64) {
        const fixed = take(5);
        const architecture = bytes[fixed + 1];
        if (bytes[fixed] !== 0 || (architecture !== 0 && architecture !== 1))
          throw new Error("Invalid FIT definition.");
        const little = architecture === 0;
        const global = view.getUint16(fixed + 2, little);
        const count = bytes[fixed + 4] as number;
        const fields: Field[] = [];
        const ids = new Set<number>();
        for (let i = 0; i < count; i++) {
          const f = take(3);
          const id = bytes[f] as number,
            size = bytes[f + 1] as number;
          if (!size || ids.has(id)) throw new Error("Invalid FIT field definition.");
          ids.add(id);
          fields.push({ id, size, type: bytes[f + 2] as number });
        }
        let developer = 0;
        if (h & 32) {
          const count = bytes[take(1)] as number;
          for (let i = 0; i < count; i++) {
            const f = take(3);
            if (!bytes[f + 1]) throw new Error("Invalid FIT developer field.");
            developer += bytes[f + 1] as number;
          }
        }
        definitions.set(local, { global, little, fields, developer });
        continue;
      }
      const definition = definitions.get(local);
      if (!definition) throw new Error("Undefined FIT local message.");
      const values = new Map<number, number>();
      if (
        compressed &&
        !definition.fields.some((f) => f.id === 253 && f.size === 4 && (f.type & 31) === 6)
      )
        throw new Error("Compressed FIT message lacks timestamp field.");
      for (const field of definition.fields) {
        if (compressed && field.id === 253) continue;
        const value = scalar(field, take(field.size), definition.little);
        if (
          value !== undefined &&
          (field.id !== 253 || (field.size === 4 && (field.type & 31) === 6))
        )
          values.set(field.id, value);
      }
      take(definition.developer);
      if (compressed) {
        if (previousTimestamp === undefined)
          throw new Error("Compressed FIT timestamp has no base.");
        let time = Math.floor(previousTimestamp / 32) * 32 + (h & 31);
        if (time < previousTimestamp) time += 32;
        values.set(253, time);
      }
      const time = values.get(253);
      if (time !== undefined) previousTimestamp = time;
      const date = (field: number) => {
        const n = values.get(field);
        return n === undefined || n < 0 || n > 0xfffffffe ? undefined : EPOCH + n * 1000;
      };
      const scaled = (field: number, scale = 1, subtract = 0) => {
        const n = values.get(field);
        return n === undefined ? undefined : n / scale - subtract;
      };
      if (definition.global === 0) {
        if (values.get(0) !== undefined && values.get(0) !== 4)
          throw new Error("FIT file is not an activity.");
        serial = values.get(3)?.toString();
        creator =
          [values.get(1), values.get(2)].filter((v) => v !== undefined).join(":") || undefined;
        if (activity) {
          activity.serial = serial;
          activity.creator = creator;
        }
      } else if (definition.global === 20) {
        const point: Point = {
          time: date(253),
          lat: scaled(0, 2147483648 / 180),
          lon: scaled(1, 2147483648 / 180),
          altitude: scaled(78, 5, 500) ?? scaled(2, 5, 500),
          hr: values.get(3),
          cadence: values.get(4),
          distance: scaled(5, 100),
          speed: scaled(73, 1000) ?? scaled(6, 1000),
          power: values.get(7),
          temperature: values.get(13),
        };
        current().point(point);
      } else if (definition.global === 18 || definition.global === 19) {
        const a = current();
        a.summary = true;
        const session = definition.global === 18;
        if (session) {
          a.start = date(2) ?? a.start;
          a.end = date(253) ?? a.end;
          a.sport = sport(SPORTS[values.get(5) ?? 0] ?? "workout");
          if (a.sport === "cycling" && values.get(6) === 6) a.sport = "indoor cycling";
          a.duration = scaled(7, 1000) ?? a.duration; // elapsed, for cross-format identity
          a.distance = scaled(9, 100) ?? a.distance;
          a.calories = values.get(11) ?? a.calories;
          a.avgHr = values.get(16) ?? a.avgHr;
          a.maxHr = values.get(17) ?? a.maxHr;
          a.elevation = values.get(22) ?? a.elevation;
          out.push(a.finish());
          activity = undefined;
        } else {
          a.start ??= date(2);
          a.end = date(253) ?? a.end;
          // Laps can provide a summary when the session is absent.
          if (values.has(7)) a.duration = (a.duration ?? 0) + (scaled(7, 1000) as number);
          if (values.has(11)) a.calories = (a.calories ?? 0) + (values.get(11) as number);
          if (values.has(9)) {
            lapDistance += scaled(9, 100) as number;
            a.distance = lapDistance;
          }
          if (values.has(21)) {
            lapElevation += values.get(21) as number;
            a.elevation = lapElevation;
          }
          const duration = scaled(7, 1000);
          if (values.has(15) && duration) {
            lapHr += (values.get(15) as number) * duration;
            lapWeight += duration;
            a.avgHr = lapHr / lapWeight;
          }
          if (values.has(16)) a.maxHr = Math.max(a.maxHr ?? 0, values.get(16) as number);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof ActivityCap)) throw error;
    if (activity) activity.truncated = true;
  }
  if (activity) out.push(activity.finish());
  return out;
}
