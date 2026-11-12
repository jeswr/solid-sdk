// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  crc16,
  FIT_EPOCH,
  FIT_START,
  FitEncoder,
  S32,
  semi,
  syntheticFit,
  U8,
  U16,
  U32,
} from "../../test/activity-fixtures.js";
import { fitActivities, fitCrc } from "./fit.js";
import { ActivityBudget } from "./model.js";

const parse = (bytes: Uint8Array, budget = new ActivityBudget()) => fitActivities(bytes, budget);
function repaired(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  if (copy[0] === 14) view.setUint16(12, crc16(copy.subarray(0, 12)), true);
  view.setUint16(copy.length - 2, crc16(copy.subarray(0, -2)), true);
  return copy;
}
describe("bounded FIT binary decoder", () => {
  it("agrees with the independent encoder CRC", () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(fitCrc(bytes)).toBe(0xbb3d);
    expect(fitCrc(bytes)).toBe(crc16(bytes));
  });
  it.each([12, 14])("supports %s-byte headers and big-endian definitions", (header) => {
    const bytes = new FitEncoder()
      .definition(0, 20, [U32(253), S32(0), S32(1), U16(2)], [], false)
      .data(0, { 253: FIT_START, 0: semi(-33.5), 1: semi(150), 2: 2600 })
      .file(header);
    const [activity] = parse(bytes);
    expect(activity?.start).toBe(FIT_EPOCH + FIT_START * 1000);
    expect(activity?.track[0]?.lat).toBeCloseTo(-33.5, 5);
    expect(activity?.track[0]?.lon).toBeCloseTo(150, 5);
    expect(activity?.track[0]?.altitude).toBe(20);
  });
  it("handles compressed timestamp rollover and unchanged offsets", () => {
    // Spec-conformant compressed records use a definition without field 253.
    const bytes = new FitEncoder()
      .definition(0, 20, [U32(253), S32(0), S32(1)])
      .definition(1, 20, [S32(0), S32(1)])
      .data(0, { 253: 1023, 0: 0, 1: 0 })
      .data(1, { 0: 0, 1: 0 }, 1024)
      .data(1, { 0: 0, 1: 0 }, 1024)
      .data(1, { 0: 0, 1: 0 }, 1050)
      // Offset 4 < previous low bits 26: a second rollover, 37 s after the full timestamp.
      .data(1, { 0: 0, 1: 0 }, 1060)
      .file();
    const [a] = parse(bytes);
    expect(a?.track.map((p) => p.time)).toEqual(
      [1023, 1024, 1024, 1050, 1060].map((t) => FIT_EPOCH + t * 1000),
    );
  });
  it("decodes a declared field 253 in a compressed record but keeps the header time", () => {
    const bytes = new FitEncoder()
      .definition(0, 20, [U32(253), S32(0), S32(1)])
      .definition(1, 20, [S32(0), U32(253), S32(1), U8(3)])
      .data(0, { 253: FIT_START, 0: semi(1), 1: semi(2) })
      .data(1, { 0: semi(3), 253: FIT_START + 999, 1: semi(4), 3: 123 }, FIT_START + 3)
      .data(1, { 0: semi(5), 253: FIT_START + 999, 1: semi(6), 3: 124 }, FIT_START + 4)
      .data(0, { 253: FIT_START + 10, 0: semi(7), 1: semi(8) })
      .file();
    const [a] = parse(bytes);
    expect(a?.track.map((p) => p.time)).toEqual(
      [0, 3, 4, 10].map((t) => FIT_EPOCH + (FIT_START + t) * 1000),
    );
    expect(a?.track[1]?.lat).toBeCloseTo(3, 5);
    expect(a?.track[1]?.lon).toBeCloseTo(4, 5);
    expect(a?.track.slice(1, 3).map((p) => p.hr)).toEqual([123, 124]);
    expect(a?.track[3]?.lon).toBeCloseTo(8, 5);
    expect(a?.duration).toBe(10);
  });
  it("skips unknown field sizes, developer data, and unknown message types without losing alignment", () => {
    const bytes = new FitEncoder()
      .definition(0, 999, [{ id: 1, size: 250, type: 7 }], [100])
      .data(0, {})
      .definition(0, 20, [U32(253), S32(0), S32(1), { id: 200, size: 20, type: 7 }], [4, 7])
      .data(0, { 253: FIT_START, 0: 0, 1: 0 })
      .file();
    expect(parse(bytes)[0]?.track).toHaveLength(1);
  });
  it("skips FIT invalid sentinel values and out-of-range coordinates", () => {
    const bytes = new FitEncoder()
      .definition(0, 20, [U32(253), S32(0), S32(1), U16(2), U8(3), U16(6)])
      .data(0, { 253: FIT_START, 0: semi(0), 1: semi(0) })
      .data(0, { 253: FIT_START + 1, 0: semi(95), 1: 0, 3: 255 })
      .file();
    const [a] = parse(bytes);
    expect(a?.track).toHaveLength(1);
    expect(a?.track[0]?.altitude).toBeUndefined();
    expect(a?.avgHr).toBeUndefined();
    expect(a?.duration).toBe(1);
  });
  it("decodes legacy altitude/speed, heart rate, cadence, distance, power and signed temperature", () => {
    const bytes = new FitEncoder()
      .definition(0, 20, [
        U32(253),
        S32(0),
        S32(1),
        U16(2),
        U8(3),
        U8(4),
        U32(5),
        U16(6),
        U16(7),
        { id: 13, size: 1, type: 1 },
      ])
      .data(0, {
        253: FIT_START,
        0: 0,
        1: 0,
        2: 2510,
        3: 100,
        4: 50,
        5: 12345,
        6: 1234,
        7: 300,
        13: -10,
      })
      .file();
    expect(parse(bytes)[0]?.track[0]).toMatchObject({
      altitude: 2,
      hr: 100,
      cadence: 50,
      distance: 123.45,
      speed: 1.234,
      power: 300,
      temperature: -10,
    });
  });
  it("splits sessions into independent activities and preserves file identity", () => {
    const e = new FitEncoder()
      .definition(0, 0, [U8(0), U32(3)])
      .data(0, { 0: 4, 3: 42 })
      .definition(1, 20, [U32(253)])
      .definition(2, 18, [U32(253), U32(2), U8(5), U32(7)]);
    e.data(1, { 253: FIT_START })
      .data(2, { 253: FIT_START + 20, 2: FIT_START, 5: 1, 7: 20000 })
      .data(1, { 253: FIT_START + 60 })
      .data(2, { 253: FIT_START + 80, 2: FIT_START + 60, 5: 2, 7: 20000 });
    const activities = parse(e.file());
    expect(activities.map((a) => a.sport)).toEqual(["running", "cycling"]);
    expect(activities.map((a) => a.serial)).toEqual(["42", "42"]);
  });
  it.each([
    ["records", { records: 1 }],
    ["points", { points: 1 }],
    ["messages", { messages: 3 }],
    ["activities", { activities: 1 }],
  ])("bounds %s across FIT messages", (_name, limits) => {
    const e = new FitEncoder()
      .definition(0, 20, [U32(253), S32(0), S32(1)])
      .definition(1, 18, [U32(2), U32(7)])
      .data(0, { 253: FIT_START, 0: 0, 1: 0 })
      .data(0, { 253: FIT_START + 10, 0: 0, 1: 0 })
      .data(1, { 2: FIT_START, 7: 10000 })
      .data(0, { 253: FIT_START + 60, 0: 0, 1: 0 })
      .data(1, { 2: FIT_START + 60, 7: 10000 });
    const budget = new ActivityBudget(limits);
    parse(e.file(), budget);
    expect([...budget.warnings].some((w) => w.endsWith("cap-exceeded"))).toBe(true);
  });
  it.each([
    "badHeaderSize",
    "badSignature",
    "badProtocol",
    "badHeaderCrc",
    "badCrc",
    "extraBytes",
    "shortHeader",
    "bogusSize",
  ])("rejects %s", (kind) => {
    let bytes = syntheticFit().slice();
    if (kind === "badHeaderSize") bytes[0] = 255;
    if (kind === "badSignature") bytes[8] = 0;
    if (kind === "badProtocol") bytes[1] = 0xf0;
    if (kind === "badHeaderCrc") bytes[12] ^= 1;
    if (kind === "badCrc") bytes[bytes.length - 1] ^= 1;
    if (kind === "extraBytes") {
      const extra = new Uint8Array(bytes.length + 1);
      extra.set(bytes);
      bytes = extra;
    }
    if (kind === "shortHeader") bytes = bytes.subarray(0, 8);
    if (kind === "bogusSize") new DataView(bytes.buffer).setUint32(4, 0xffffffff, true);
    expect(() => parse(bytes)).toThrow();
  });
  it.each(
    [
      [0], // data without a local definition
      [64, 0, 2, 20, 0, 0], // architecture
      [64, 1, 0, 20, 0, 0], // reserved byte
      [64, 0, 0, 20, 0, 1, 253, 4], // truncated definition
      [64, 0, 0, 20, 0, 1, 253, 0, 134], // zero field size
      [64, 0, 0, 20, 0, 2, 253, 4, 134, 253, 4, 134], // duplicate field
      [96, 0, 0, 20, 0, 0, 1, 0, 0, 0], // zero developer size
      [16], // reserved header bit
      [32], // developer flag on data
    ].map((body) => [body]),
  )("rejects structurally invalid messages %j, even with a valid CRC", (body) => {
    const e = new FitEncoder();
    e.body.push(...body);
    expect(() => parse(e.file())).toThrow();
  });
  it("rejects compressed timestamps without a base but never requires field 253", () => {
    const noBase = new FitEncoder()
      .definition(0, 20, [U8(3)])
      .data(0, { 3: 100 }, 1)
      .file();
    expect(() => parse(noBase)).toThrow("no base");
    const based = new FitEncoder()
      .definition(0, 20, [U32(253)])
      .definition(1, 20, [U8(3)])
      .data(0, { 253: FIT_START })
      .data(1, { 3: 100 }, FIT_START + 2)
      .file();
    const [a] = parse(based);
    expect(a?.end).toBe(FIT_EPOCH + (FIT_START + 2) * 1000);
    expect(a?.maxHr).toBe(100);
  });
  it("rejects truncated data and developer bytes with a corrected overall size/CRC", () => {
    const e = new FitEncoder().definition(0, 20, [U32(253)], [5]).data(0, { 253: FIT_START });
    e.body.pop();
    expect(() => parse(e.file())).toThrow("Truncated FIT message");
  });
  it("rejects non-activity FIT file IDs", () => {
    const e = new FitEncoder().definition(0, 0, [U8(0)]).data(0, { 0: 1 });
    expect(() => parse(e.file())).toThrow("not an activity");
  });
  it("allows the protocol-defined omitted header CRC but still checks file CRC", () => {
    const bytes = syntheticFit().slice();
    bytes[12] = 0;
    bytes[13] = 0;
    const view = new DataView(bytes.buffer);
    view.setUint16(bytes.length - 2, crc16(bytes.subarray(0, -2)), true);
    expect(parse(bytes)).toHaveLength(1);
    bytes[20] ^= 1;
    expect(() => parse(bytes)).toThrow("CRC");
  });
  it("does not trust a valid CRC to override malformed field sizes", () => {
    const bytes = syntheticFit();
    bytes[14 + 5] = 255;
    expect(() => parse(repaired(bytes))).toThrow();
  });
});

it("maps lap summaries when the session message is absent", () => {
  const e = new FitEncoder()
    .definition(0, 19, [U32(253), U32(2), U32(7), U32(9), U16(11), U8(15), U8(16), U16(21)])
    .data(0, {
      253: FIT_START + 30,
      2: FIT_START,
      7: 30000,
      9: 5000,
      11: 5,
      15: 140,
      16: 170,
      21: 2,
    })
    .data(0, {
      253: FIT_START + 60,
      2: FIT_START + 30,
      7: 30000,
      9: 6000,
      11: 6,
      15: 160,
      16: 180,
      21: 3,
    });
  const [a] = parse(e.file());
  expect(a).toMatchObject({
    duration: 60,
    distance: 110,
    calories: 11,
    avgHr: 150,
    maxHr: 180,
    elevation: 5,
  });
});

it("keeps indoor cycling out of Mobility", () => {
  const bytes = new FitEncoder()
    .definition(0, 18, [U32(2), U8(5), U8(6), U32(7)])
    .data(0, { 2: FIT_START, 5: 2, 6: 6, 7: 60000 })
    .file();
  expect(parse(bytes)[0]?.sport).toBe("indoor cycling");
});

it("omits missing lap calories and derives elapsed duration when lap timing is absent", () => {
  const bytes = new FitEncoder()
    .definition(0, 20, [U32(253)])
    .data(0, { 253: FIT_START })
    .data(0, { 253: FIT_START + 60 })
    .definition(1, 19, [U32(2)])
    .data(1, { 2: FIT_START })
    .file();
  expect(parse(bytes)[0]).toMatchObject({ duration: 60, calories: undefined });
});
