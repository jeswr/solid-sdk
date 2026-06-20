// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { parseICalDate } from "../src/datetime.js";

const XSD_DATE = "http://www.w3.org/2001/XMLSchema#date";
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";

describe("parseICalDate", () => {
  it("parses a UTC DATE-TIME (trailing Z)", () => {
    expect(parseICalDate("20260622T090000Z")).toEqual({
      value: "2026-06-22T09:00:00Z",
      datatype: XSD_DATE_TIME,
    });
  });

  it("parses a floating DATE-TIME (no offset emitted)", () => {
    expect(parseICalDate("20260622T140000")).toEqual({
      value: "2026-06-22T14:00:00",
      datatype: XSD_DATE_TIME,
    });
  });

  it("parses a bare 8-digit value as xsd:date", () => {
    expect(parseICalDate("20261225")).toEqual({ value: "2026-12-25", datatype: XSD_DATE });
  });

  it("honours VALUE=DATE (isDate flag) for an 8-digit value", () => {
    expect(parseICalDate("20261225", true)).toEqual({ value: "2026-12-25", datatype: XSD_DATE });
  });

  it("VALUE=DATE on a date-time value is rejected (drops the field)", () => {
    // isDate=true but a DATE-TIME string does not match the DATE regex → undefined.
    expect(parseICalDate("20260622T090000Z", true)).toBeUndefined();
  });

  it("drops a non-string / empty / garbage value (never throws)", () => {
    expect(parseICalDate(undefined)).toBeUndefined();
    expect(parseICalDate("")).toBeUndefined();
    expect(parseICalDate("   ")).toBeUndefined();
    expect(parseICalDate("not-a-date")).toBeUndefined();
    expect(parseICalDate(12345 as unknown)).toBeUndefined();
    expect(parseICalDate({} as unknown)).toBeUndefined();
  });

  it("drops an out-of-bounds month / day / time", () => {
    expect(parseICalDate("20261301")).toBeUndefined(); // month 13
    expect(parseICalDate("20260100")).toBeUndefined(); // day 0
    expect(parseICalDate("20260622T250000Z")).toBeUndefined(); // hour 25
    expect(parseICalDate("20260622T096100Z")).toBeUndefined(); // minute 61
  });

  it("trims surrounding whitespace", () => {
    expect(parseICalDate("  20261225  ")?.value).toBe("2026-12-25");
  });
});
