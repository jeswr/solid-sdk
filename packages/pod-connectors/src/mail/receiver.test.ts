// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  googleAuthentication,
  googleReceivedTime,
  markupSender,
  receiverHeaders,
  receiverTime,
} from "./receiver.js";

const raw = (...headers: string[]) =>
  new TextEncoder().encode([...headers, "", "body"].join("\r\n"));
const google = (result: string) => `Authentication-Results: mx.google.com; ${result}`;
const pass = "dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.test";
describe("Google receiver evidence", () => {
  it("uses only the top-most Google authentication result, preserving duplicates and folds", () => {
    expect(
      googleAuthentication(
        raw(google("dmarc=fail header.from=example.test"), google(pass)),
        "receipts@example.test",
      ),
    ).toBeUndefined();
    expect(
      googleAuthentication(
        raw("Authentication-Results: attacker.test; dmarc=pass header.from=example.test"),
        "receipts@example.test",
      ),
    ).toBeUndefined();
    expect(
      googleAuthentication(
        raw(google(pass), google("dmarc=fail header.from=example.test")),
        "receipts@example.test",
      ),
    ).toEqual({ dmarc: "pass", alignedDomain: "example.test" });
    expect(
      googleAuthentication(
        raw("Authentication-Results: MX.GOOGLE.COM;\r\n\tdmarc=pass header.from=EXAMPLE.TEST"),
        "mailto:receipts%40example.test",
      ),
    ).toEqual({ dmarc: "pass", alignedDomain: "example.test" });
  });
  it.each([
    "dmarc=pass header.from=evil.test",
    "dmarc=pass header.from=user@example.test",
    "dmarc=pass header.from=example.test.evil.test",
    "dmarc=pass header.from=notexample.test",
    "dmarc=pass",
    "dmarc=fail header.from=example.test; spf=pass; dkim=pass",
    "dmarc=pass header.from=example.test; dmarc=fail header.from=example.test",
    'dmarc=pass reason="header.from=example.test"',
    "dmarc=pass (header.from=example.test)",
    "dmarc=pass header.from=example.test header.from=evil.test",
  ])("refuses ambiguous or mismatched evidence: %s", (result) => {
    expect(googleAuthentication(raw(google(result)), "receipts@example.test")).toBeUndefined();
  });
  it.each([
    "mx.google.com (receiver comment); dmarc=fail header.from=example.test",
    "mx.google.com 1; dmarc=fail header.from=example.test",
    '"mx.google.com"; dmarc=fail header.from=example.test',
    "(receiver (nested) comment) mx.google.com; dmarc=fail header.from=example.test",
    "(receiver \\) comment) mx.google.com; dmarc=fail header.from=example.test",
    "mx.google.com",
  ])("never falls through an unsupported first Google assertion: %s", (first) => {
    expect(
      googleAuthentication(
        raw(`Authentication-Results: ${first}`, google(pass)),
        "receipts@example.test",
      ),
    ).toBeUndefined();
  });
  it("uses aligned domains only with consistent evidence, and lowercases unverified From domains", () => {
    expect(
      markupSender("mailto:r%40Sub.Example.test", { dmarc: "pass", alignedDomain: "example.test" }),
    ).toEqual({ trust: "verified", senderKey: "example.test" });
    expect(markupSender("r@Example.test", { dmarc: "pass", alignedDomain: "evil.test" })).toEqual({
      trust: "unverified",
      senderKey: "example.test",
    });
    expect(markupSender("r@Example.test")).toEqual({
      trust: "unverified",
      senderKey: "example.test",
    });
    expect(markupSender(undefined, { dmarc: "pass" }).trust).toBe("unverified");
    for (const from of [
      "example.test",
      "mailto:example.test",
      "@example.test",
      "a@b@example.test",
      "mailto:%FF",
    ]) {
      expect(markupSender(from, { dmarc: "pass", alignedDomain: "example.test" })).toEqual({
        trust: "unverified",
        senderKey: undefined,
      });
      expect(googleAuthentication(raw(google(pass)), from)).toBeUndefined();
    }
    expect(googleAuthentication(raw(google(pass)), undefined)).toBeUndefined();
  });
  it("ignores body headers and incomplete oversized headers", () => {
    expect(receiverHeaders(new TextEncoder().encode(google(pass)))).toEqual([]);
    expect(
      googleAuthentication(raw("From: r@example.test", "", google(pass)), "r@example.test"),
    ).toBeUndefined();
    expect(receiverHeaders(raw(`X-Padding: ${"x".repeat(65536)}`, google(pass)))).toEqual([]);
  });
  it("uses the first Google Received timestamp and clamps future receiver time", () => {
    const old = "Thu, 01 Jan 2026 09:00:00 +0000";
    expect(
      googleReceivedTime(
        raw(
          `Received: from a by mx.google.com; ${old}`,
          "Received: from a by mx.google.com; Fri, 01 Jan 2099 00:00:00 +0000",
        ),
      ),
    ).toEqual(new Date(old));
    expect(
      googleReceivedTime(raw("Received: from a by evil.test; Fri, 01 Jan 2099 00:00:00 +0000")),
    ).toBeUndefined();
    expect(
      googleReceivedTime(
        raw(
          "Received: from a by mx.google.com; invalid",
          `Received: from a by mx.google.com; ${old}`,
        ),
      ),
    ).toBeUndefined();
    expect(
      googleReceivedTime(raw(`Received: from sender by evil.test (by mx.google.com); ${old}`)),
    ).toBeUndefined();
    expect(
      googleReceivedTime(raw(`Received: from sender by mx.google.com.evil.test; ${old}`)),
    ).toBeUndefined();
    expect(
      googleReceivedTime(
        raw(
          `Received: from sender by evil.test; ${old}`,
          `Received: from sender by mx.google.com; ${old}`,
        ),
      ),
    ).toBeUndefined();
    expect(receiverTime(new Date("2099-01-01"), new Date(old))).toEqual(new Date(old));
    expect(receiverTime(new Date(NaN))).toBeUndefined();
  });
});
