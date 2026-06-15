// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pure formatter tests — the defensive money/date/label rendering the accounts
// view depends on. Financial data is sensitive: every helper must produce a
// stable placeholder (never throw) on missing / NaN / invalid input.

import { describe, expect, it } from "vitest";
import {
  accountDisplayLabel,
  errorMessage,
  formatAccountKind,
  formatAccountStatus,
  formatDate,
  formatMoney,
  formatTransactionKind,
  iriLeaf,
  PLACEHOLDER,
} from "../../src/ui/format.js";

describe("formatMoney", () => {
  it("formats a value with a valid ISO 4217 currency", () => {
    // £ is the GBP sign; assert via the code-point so the source has no
    // raw non-ASCII money glyph.
    expect(formatMoney(-19.99, "GBP")).toBe("-£19.99");
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
  });

  it("returns the placeholder for a missing or non-finite amount", () => {
    expect(formatMoney(undefined, "GBP")).toBe(PLACEHOLDER);
    expect(formatMoney(Number.NaN, "GBP")).toBe(PLACEHOLDER);
    expect(formatMoney(Number.POSITIVE_INFINITY, "GBP")).toBe(PLACEHOLDER);
    expect(formatMoney(Number.NEGATIVE_INFINITY, "GBP")).toBe(PLACEHOLDER);
  });

  it("renders the amount alone (2dp) when the currency is missing or empty", () => {
    expect(formatMoney(42, undefined)).toBe("42.00");
    expect(formatMoney(42, "")).toBe("42.00");
  });

  it("falls back to a plain rendering when the currency code is invalid (no throw)", () => {
    // "XYZ" is not a real ISO 4217 code; Intl.NumberFormat throws — we must not.
    expect(formatMoney(10, "NOTACODE")).toBe("NOTACODE 10.00");
  });
});

describe("formatDate", () => {
  it("renders an ISO date for a valid Date", () => {
    expect(formatDate(new Date("2026-06-15T10:00:00Z"))).toBe("2026-06-15");
  });

  it("returns the placeholder for an absent or invalid Date (never throws)", () => {
    expect(formatDate(undefined)).toBe(PLACEHOLDER);
    expect(formatDate(new Date("nonsense"))).toBe(PLACEHOLDER);
  });
});

describe("account/transaction kind + status labels", () => {
  it("formats account kind, with a fallback", () => {
    expect(formatAccountKind("Current")).toBe("Current");
    expect(formatAccountKind(undefined)).toBe("Account");
  });

  it("formats account status, with a placeholder fallback", () => {
    expect(formatAccountStatus("Active")).toBe("Active");
    expect(formatAccountStatus(undefined)).toBe(PLACEHOLDER);
  });

  it("formats transaction kind, with a fallback", () => {
    expect(formatTransactionKind("CardPayment")).toBe("CardPayment");
    expect(formatTransactionKind(undefined)).toBe("Transaction");
  });
});

describe("accountDisplayLabel", () => {
  it("uses the label when present and non-blank", () => {
    expect(accountDisplayLabel("Everyday", "https://pod.example/finance/ledger.ttl#a")).toBe(
      "Everyday",
    );
  });

  it("falls back to the IRI leaf for a missing or blank label", () => {
    expect(accountDisplayLabel(undefined, "https://pod.example/finance/ledger.ttl#everyday")).toBe(
      "everyday",
    );
    expect(accountDisplayLabel("   ", "https://pod.example/finance/ledger.ttl#savings")).toBe(
      "savings",
    );
  });
});

describe("iriLeaf", () => {
  it("returns the decoded fragment after #", () => {
    expect(iriLeaf("https://pod.example/x#joint%20account")).toBe("joint account");
  });

  it("returns the last path segment when there is no fragment", () => {
    expect(iriLeaf("https://pod.example/people/alice")).toBe("alice");
    expect(iriLeaf("https://pod.example/people/alice/")).toBe("alice");
  });

  it("treats a trailing # (empty fragment) as no fragment, using the path", () => {
    expect(iriLeaf("https://pod.example/people/bob#")).toBe("bob");
  });

  it("uses the host for a bare pod root, and the whole value when there is no slash", () => {
    expect(iriLeaf("https://pod.example/")).toBe("pod.example");
    expect(iriLeaf("urn:uuid:abc")).toBe("urn:uuid:abc");
  });

  it("returns the segment unchanged when it is not valid percent-encoding", () => {
    // A bad escape makes decodeURIComponent throw; the catch returns it verbatim
    // — exercised on BOTH the fragment route and the path route.
    expect(iriLeaf("https://pod.example/x#bad%zz")).toBe("bad%zz");
    expect(iriLeaf("https://pod.example/people/bad%zz")).toBe("bad%zz");
  });
});

describe("errorMessage", () => {
  it("uses an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error value", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
