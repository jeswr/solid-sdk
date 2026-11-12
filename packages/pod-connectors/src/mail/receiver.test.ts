// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  gmailTrace,
  googleAuthenticationResults,
  googleMxReceived,
} from "../../test-support/markup-fixtures.js";
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
/** Headers directly below Google's inbound MX receipt, the only anchored position. */
const anchored = (...headers: string[]) => raw(...googleMxReceived(), ...headers);
const pass = "dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.test";
describe("Google receiver evidence", () => {
  it("uses only the top-most Google authentication result, preserving duplicates and folds", () => {
    expect(
      googleAuthentication(
        anchored(google("dmarc=fail header.from=example.test"), google(pass)),
        "receipts@example.test",
      ),
    ).toBeUndefined();
    expect(
      googleAuthentication(
        anchored("Authentication-Results: attacker.test; dmarc=pass header.from=example.test"),
        "receipts@example.test",
      ),
    ).toBeUndefined();
    expect(
      googleAuthentication(
        anchored(google(pass), google("dmarc=fail header.from=example.test")),
        "receipts@example.test",
      ),
    ).toEqual({ dmarc: "pass", alignedDomain: "example.test" });
    expect(
      googleAuthentication(
        anchored("Authentication-Results: MX.GOOGLE.COM;\r\n\tdmarc=pass header.from=EXAMPLE.TEST"),
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
    expect(googleAuthentication(anchored(google(result)), "receipts@example.test")).toBeUndefined();
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
        anchored(`Authentication-Results: ${first}`, google(pass)),
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
      expect(googleAuthentication(anchored(google(pass)), from)).toBeUndefined();
    }
    expect(googleAuthentication(anchored(google(pass)), "receipts@example.test")).toBeDefined();
    expect(googleAuthentication(anchored(google(pass)), undefined)).toBeUndefined();
  });
  it("ignores body headers and incomplete oversized headers", () => {
    expect(receiverHeaders(new TextEncoder().encode(google(pass)))).toEqual([]);
    expect(
      googleAuthentication(
        raw(...googleMxReceived(), "From: r@example.test", "", google(pass)),
        "r@example.test",
      ),
    ).toBeUndefined();
    expect(receiverHeaders(raw(`X-Padding: ${"x".repeat(65536)}`, google(pass)))).toEqual([]);
  });
  it("dates only the positionally anchored inbound MX receipt and clamps future receiver time", () => {
    const old = "Thu, 01 Jan 2026 09:00:00 +0000";
    const future = "Fri, 01 Jan 2099 00:00:00 +0000";
    expect(googleReceivedTime(raw(...gmailTrace(pass, old)))).toEqual(new Date(old));
    // The receipt nearest the top wins; a lower duplicate is sender-supplied.
    expect(googleReceivedTime(raw(...googleMxReceived(old), ...googleMxReceived(future)))).toEqual(
      new Date(old),
    );
    expect(receiverTime(new Date("2099-01-01"), new Date(old))).toEqual(new Date(old));
    expect(receiverTime(new Date(NaN))).toBeUndefined();
    for (const headers of [
      [`Received: from a by evil.test with ESMTPS id 1; ${future}`],
      // Comments cannot supply the receiver; look-alike hosts are not Google.
      [`Received: from sender by evil.test with ESMTPS id 1 (by mx.google.com); ${old}`],
      [`Received: from sender by mx.google.com.evil.test with ESMTPS id 1; ${old}`],
      // A non-Google hop above it means the receipt was added before Google saw the message.
      [`Received: from sender by evil.test with ESMTPS id 1; ${old}`, ...googleMxReceived(old)],
      // Unparseable, missing-protocol and POP3/IMAP/HTTP receipts are never anchors.
      [...googleMxReceived("invalid"), ...googleMxReceived(old)],
      [`Received: from a by mx.google.com; ${old}`],
      [`Received: by mx.google.com with ESMTPS id 1; ${old}`],
      ...["POP3", "IMAP", "HTTP", "HTTPREST", "SMTP"].map((protocol) =>
        googleMxReceived(old, protocol),
      ),
      [
        `Received: from 1 named unknown by gmailapi.google.com with HTTPREST; ${old}`,
        ...googleMxReceived(old),
      ],
      [`Received: by 2002:a05::1 with HTTP id 1; ${old}`, ...googleMxReceived(old)],
      [`Received: by 2002:a05::1 with SMTP; ${old}`, ...googleMxReceived(old)],
      [`Received: by 2002:zz::1 with SMTP id 1; ${old}`, ...googleMxReceived(old)],
      [`Received: by 256.1.1.1 with SMTP id 1; ${old}`, ...googleMxReceived(old)],
      // An Authentication-Results above the receipt is out of position.
      [google(pass), ...googleMxReceived(old)],
      // Ambiguous traces fail closed.
      [`Received: from a by mx.google.com with ESMTPS id 1 by b.google.com; ${old}`],
      [`Received: from a by mx.google.com with ESMTPS id 1; ${old}; ${old}`],
      [`Received: from a by mx.google.com with ESMTPS id 1 (unclosed; ${old}`],
    ])
      expect(googleReceivedTime(raw(...headers)), headers.join("|")).toBeUndefined();
    // Google relay hops by host or internal IP literal may sit above the receipt.
    for (const hop of [
      `Received: by 10.20.30.40 with SMTP id q1; ${old}`,
      `Received: by [2002:a05:6a10::1234] with SMTP id q1; ${old}`,
      `Received: from mail-sor-f41.google.com by relay.google.com with ESMTPS id q1; ${old}`,
    ])
      expect(googleReceivedTime(raw(hop, ...googleMxReceived(old))), hop).toEqual(new Date(old));
  });
});

describe("Google receiver position", () => {
  const from = "receipts@example.test";
  it("verifies Google's assertion in a genuine Gmail header layout", () => {
    expect(googleAuthentication(raw(...gmailTrace(pass)), from)).toEqual({
      dmarc: "pass",
      alignedDomain: "example.test",
    });
    expect(
      googleAuthentication(
        raw(
          "Delivered-To: alex@example.test",
          ...gmailTrace(pass),
          // Sender-side trace and assertions below Google's block are ignored.
          "Received: from relay.example.test by mta.example.test with ESMTP id 1; Thu, 01 Jan 2026 07:59:00 +0000",
          google("dmarc=fail header.from=example.test"),
        ),
        from,
      ),
    ).toEqual({ dmarc: "pass", alignedDomain: "example.test" });
  });
  it("refuses a forged Google assertion below a non-Google Received when Google's own is absent", () => {
    // Migrated or appended mail: another provider's trace on top, a sender-forged result below.
    expect(
      googleAuthentication(
        raw(
          "Received: from relay.attacker.test by mx.oldprovider.test with ESMTP id 9; Wed, 02 Dec 2026 09:00:00 +0000",
          "Authentication-Results: mx.oldprovider.test; dmarc=fail header.from=example.test",
          ...googleMxReceived(),
          google(pass),
        ),
        from,
      ),
    ).toBeUndefined();
    expect(
      googleAuthentication(
        raw(
          "Received: from relay.attacker.test by mx.oldprovider.test with ESMTP id 9; Wed, 02 Dec 2026 09:00:00 +0000",
          google(pass),
        ),
        from,
      ),
    ).toBeUndefined();
    // No receipt at all, or a receipt that is not directly above the assertion.
    expect(googleAuthentication(raw(google(pass)), from)).toBeUndefined();
    expect(
      googleAuthentication(
        raw(
          ...googleMxReceived(),
          "Received: from relay.attacker.test by mta.attacker.test with ESMTP id 9; Wed, 02 Dec 2026 09:00:00 +0000",
          google(pass),
        ),
        from,
      ),
    ).toBeUndefined();
    // An assertion above the receipt is out of position and never falls through to a lower one.
    expect(
      googleAuthentication(raw(google(pass), ...googleMxReceived(), google(pass)), from),
    ).toBeUndefined();
  });
  it.each([
    "IMAP",
    "POP3",
    "HTTP",
  ])("refuses a message Google received by %s rather than its inbound MX", (protocol) => {
    expect(
      googleAuthentication(
        raw(
          `Received: by 2002:a05:6a10:1234:b0:5ab:cdef:1234 with SMTP id a1; Thu, 01 Jan 2026 08:00:00 +0000`,
          ...googleMxReceived(undefined, protocol),
          ...googleAuthenticationResults(pass),
        ),
        from,
      ),
    ).toBeUndefined();
  });
  it("refuses an API-inserted message carrying a forged inbound receipt and assertion", () => {
    expect(
      googleAuthentication(
        raw(
          "Received: from 1 named unknown by gmailapi.google.com with HTTPREST; Thu, 01 Jan 2026 08:00:00 +0000",
          ...googleMxReceived(),
          ...googleAuthenticationResults(pass),
        ),
        from,
      ),
    ).toBeUndefined();
  });
  it("splits result clauses per RFC 8601, so quoted values and comments cannot inject one", () => {
    for (const result of [
      'dkim=neutral (bad format) header.i="@x;dmarc=pass header.from=example.test;"',
      'spf=pass (comment) smtp.mailfrom="a;dmarc=pass header.from=example.test;b"@attacker.test',
      "spf=pass (dmarc=pass; header.from=example.test) smtp.mailfrom=a@example.test",
      'dmarc=pass header.from="example.test"',
      'dmarc=pass reason="x" header.from',
      "dmarc=pass header.from=example.test reason=extra",
      'dmarc=pass header.from=example.test "stray"',
      'dmarc=pass header.from=example.test; dkim=pass header.i="unterminated',
      "dmarc=pass header.from=example.test (unclosed",
      "dmarc = pass header . from = example.test",
    ])
      expect(googleAuthentication(anchored(google(result)), from), result).toBeUndefined();
    for (const result of [
      'dmarc=pass reason="quoted; reason" header.from=example.test',
      'dkim=pass header.i="@x;dmarc=fail"; dmarc=pass (p=NONE; dis=NONE) header.from=example.test',
      "DMARC = PASS policy.dmarc=reject header.from = example.test",
    ])
      expect(googleAuthentication(anchored(google(result)), from), result).toEqual({
        dmarc: "pass",
        alignedDomain: "example.test",
      });
  });
});
