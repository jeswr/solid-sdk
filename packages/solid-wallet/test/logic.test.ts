// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  expiryStatus,
  filterItems,
  groupItems,
  ITEM_KINDS,
  inputDate,
  sortItems,
  type WalletItemData,
  walletItem,
} from "../src/index.js";

const today = new Date("2026-11-11T23:59:00Z");
const item: WalletItemData = { name: "Example", kind: "passport", created: today, modified: today };
describe("expiry status", () => {
  it.each([
    [undefined, "no-expiry"],
    ["2026-11-10", "expired"],
    ["2026-11-11", "expiring-soon"],
    ["2026-12-11", "expiring-soon"],
    ["2026-12-12", "valid"],
  ])("classifies %s inclusively", (date, status) =>
    expect(expiryStatus({ expires: date ? new Date(date) : undefined }, today)).toBe(status));
  it("uses UTC calendar days and configurable windows", () => {
    expect(expiryStatus({ expires: new Date("2026-11-12") }, today, 0)).toBe("valid");
    expect(expiryStatus({ expires: new Date("2026-11-11") }, today, 0)).toBe("expiring-soon");
  });
  it.each([-1, 0.1, Infinity, NaN])("refuses a bad window %s", (days) =>
    expect(() => expiryStatus({}, today, days)).toThrow());
  it("rejects invalid dates even without expiry", () => {
    expect(() => expiryStatus({}, new Date(NaN))).toThrow();
    expect(() => expiryStatus({ expires: new Date(NaN) }, today)).toThrow();
  });
});
it("sorts without mutating, favours favourites, sorts missing dates last and groups in enum order", () => {
  const entries = [
    { ...item, name: "Zulu" },
    { ...item, name: "Birch", kind: "insurance" as const, favourite: true },
    { ...item, name: "Ash", expires: new Date("2026-11-12") },
    { ...item, name: "Early", expires: new Date("2026-11-11") },
  ];
  expect(sortItems(entries).map((x) => x.name)).toEqual(["Birch", "Ash", "Early", "Zulu"]);
  expect(sortItems(entries, "expiry").map((x) => x.name)).toEqual([
    "Early",
    "Ash",
    "Birch",
    "Zulu",
  ]);
  expect(entries[0]?.name).toBe("Zulu");
  expect(groupItems(entries).map((x) => x.kind)).toEqual(["passport", "insurance"]);
  expect(groupItems([])).toEqual([]);
});
it("searches all display fields case-insensitively and combines the kind filter", () => {
  const entry = {
    ...item,
    identifier: "DEMO42",
    issuerName: "Meadow",
    holderName: "Rowan",
    notes: "Course",
    tags: ["Travel"],
  };
  for (const query of ["demo42", "meAdOw", "ROWAN", "course", "travel", " exAMple ", ""])
    expect(filterItems([entry], query)).toEqual([entry]);
  expect(filterItems([entry], "", "insurance")).toEqual([]);
  expect(filterItems([item], "missing")).toEqual([]);
});
it("validates calendar input including leap years and year zero", () => {
  expect(inputDate("")).toBeUndefined();
  expect(inputDate("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
  for (const invalid of [
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "2026-01-00",
    "not-a-date",
    "2026-1-01",
  ])
    expect(() => inputDate(invalid)).toThrow();
});
it("round trips every generated field and all kinds, with date-only datatypes", async () => {
  for (const kind of ITEM_KINDS) {
    const data = {
      ...item,
      kind,
      identifier: "TEST-42",
      issuerName: "Fictional issuer",
      holderName: "Rowan",
      validFrom: new Date("2026-01-01"),
      expires: new Date("2027-01-01"),
      file: "https://pod.example/wallet/files/one",
      credential: "https://pod.example/wallet/credentials/one",
      notes: "Notes <not markup>",
      tags: ["travel", "sample"],
      favourite: true,
    };
    const url = "https://pod.example/wallet/item.ttl";
    const ttl = await walletItem.serialize(url, data);
    expect(await walletItem.parseDocument(url, ttl, "text/turtle")).toEqual({
      ...data,
      tags: ["sample", "travel"],
    });
  }
  expect(() => walletItem.subject("relative.ttl")).toThrow();
  expect(
    await walletItem.parseDocument("https://pod.example/no.ttl", "", "text/turtle"),
  ).toBeUndefined();
});

it("preserves early years when comparing calendar days", () => {
  expect(inputDate("0000-01-01")?.getUTCFullYear()).toBe(0);
  expect(
    expiryStatus(
      { expires: new Date("0100-01-01T00:00:00Z") },
      new Date("0099-12-31T23:00:00Z"),
      1,
    ),
  ).toBe("expiring-soon");
});
