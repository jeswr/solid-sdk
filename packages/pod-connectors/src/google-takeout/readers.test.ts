// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { readIcs, readVcards } from "./readers.js";

describe("Takeout normalized source properties", () => {
  it("uses parsed parameters for recurrence properties", () => {
    const [event] = readIcs(
      'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART;TZID="Europe/London":20260612T090000\nRRULE:FREQ=DAILY\nEXDATE;TZID="Europe/London";VALUE="DATE-TIME":20260613T090000\nRDATE;VALUE="DATE":20260614\nEND:VEVENT\nEND:VCALENDAR',
      1,
    );
    expect(event.recurrence).toEqual([
      "RRULE:FREQ=DAILY",
      "EXDATE;TZID=Europe/London;VALUE=DATE-TIME:20260613T090000",
      "RDATE;VALUE=DATE:20260614",
    ]);
  });
  it("accepts empty snapshots and rejects unrecognized nonempty cards", async () => {
    expect(await readVcards(" \n", 1)).toEqual([]);
    await expect(readVcards("not a card", 1)).rejects.toThrow(/vCard component/);
    expect(readIcs("", 1)).toEqual([]);
    expect(readIcs("BEGIN:VCALENDAR\nEND:VCALENDAR", 1)).toEqual([]);
  });
  it("normalizes repeated, quoted and comma-separated contact TYPE tokens", async () => {
    const [card] = await readVcards(
      'BEGIN:VCARD\nFN:Example\nEMAIL;TYPE="PREF,HOME":a@example.test\nTEL;TYPE=VOICE;TYPE=WORK:tel:+12025550101\nADR;TYPE=POSTAL;TYPE=HOME:;;Street;Town;;Code;Country\nEMAIL;HOME;PREF:b@example.test\nEMAIL:c@example.test\nTEL;TYPE=Cell:123\nEND:VCARD',
      1,
    );
    expect(card.person.emailAddresses?.map((value) => value.type)).toEqual([
      "home",
      "home",
      undefined,
    ]);
    expect(card.person.phoneNumbers?.map((value) => value.type)).toEqual(["work", "cell"]);
    expect(card.person.addresses?.[0].type).toBe("home");
  });
});
