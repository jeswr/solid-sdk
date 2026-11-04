// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT, DEFAULT_LIMITS } from "@jeswr/agent-model";
import { expect, it, vi } from "vitest";
import { envelope } from "../src/direct/shared.js";
import {
  decodeEnvelope,
  decodeEnvelopeObject,
  decodeEventContent,
  decodeMetadataField,
  ENVELOPE_KEY,
  encodeEnvelope,
  encodeEnvelopeObject,
  encodeEventContent,
  encodeMetadataField,
} from "../src/index.js";
import { signed } from "./fixtures/signed.js";

it("round-trips the same renamed, inline envelope through every structured carriage", () => {
  const { compactJws } = signed();
  const value = encodeEnvelopeObject(compactJws);
  const text = encodeEnvelope(compactJws);
  expect(text).toBe(envelope(compactJws));
  expect(value).toEqual({
    "@context": { agent: AGENT },
    "@type": "agent:SignedMessage",
    "agent:wireFormat": "jws-compact",
    "agent:compactJws": compactJws,
  });
  expect(decodeEnvelope(text)).toEqual({ text, compactJws });
  expect(decodeEnvelope(Buffer.from(text))).toEqual({ text, compactJws });
  expect(decodeEnvelopeObject(value)).toBe(compactJws);
  expect(decodeEnvelopeObject(Object.assign(Object.create(null), value))).toBe(compactJws);
  expect(decodeMetadataField(encodeMetadataField(compactJws))).toBe(compactJws);
  expect(encodeMetadataField(compactJws)).toEqual({
    event_type: ENVELOPE_KEY,
    event_payload: value,
  });
  expect(
    decodeEventContent({ msgtype: "m.text", body: "hello", ...encodeEventContent(compactJws) }),
  ).toBe(compactJws);
  // A Teams card's data is exactly the envelope object; no provider transport here.
  expect(decodeEnvelopeObject({ data: value }.data)).toBe(compactJws);
  expect(decodeEnvelope(`  ${text}\n`).compactJws).toBe(compactJws);
});

it("rejects malformed, oversized, non-UTF8 and deeply nested JSON without fetching contexts", () => {
  for (const raw of [
    "{",
    "null",
    "[]",
    '"text"',
    " ".repeat(65537),
    "[".repeat(30),
    new Uint8Array([255]),
    new Uint8Array(65537),
  ])
    expect(() => decodeEnvelope(raw)).toThrow();
  for (const jws of [
    undefined,
    42,
    "",
    "unsigned",
    "a.b.c.d",
    "a.b.=",
    "x".repeat(65537),
    `${"x".repeat(65400)}.b.c`,
  ])
    expect(() => encodeEnvelope(jws as string)).toThrow();
  const max = DEFAULT_LIMITS.maxEnvelopeBytes;
  const overhead = Buffer.byteLength(encodeEnvelope("a.b.c")) - 5;
  const jws = `${"a".repeat(max - overhead - 4)}.b.c`;
  expect(Buffer.byteLength(encodeEnvelope(jws))).toBe(max);
  expect(decodeEnvelope(encodeEnvelope(jws)).compactJws).toBe(jws);
  expect(() => encodeEnvelope(`${jws}x`)).toThrow("byte cap");
});

it("fails closed on changed context, wire format, fields and object hooks", () => {
  const value = encodeEnvelopeObject("a.b.c");
  for (const invalid of [
    null,
    1,
    [],
    new Date(),
    {},
    { ...value, extra: true },
    { ...value, "@context": "https://context.example/remote" },
    { ...value, "@context": { awp: AGENT } },
    { ...value, "@context": { agent: "https://attacker.example/" } },
    { ...value, "@context": { agent: AGENT, extra: "x" } },
    { ...value, "@type": "agent:Other" },
    { ...value, "agent:wireFormat": "unsigned" },
    { ...value, "agent:compactJws": null },
    { ...value, "agent:compactJws": "unsigned" },
    Object.create(value),
    Object.defineProperty({ ...value }, "@type", {
      value: "agent:SignedMessage",
      enumerable: false,
    }),
    { ...value, [Symbol("extra")]: true },
  ])
    expect(() => decodeEnvelopeObject(invalid)).toThrow();
  const get = vi.fn(() => "a.b.c");
  const accessor = Object.defineProperty({ ...value }, "agent:compactJws", { get });
  expect(() => decodeEnvelopeObject(accessor)).toThrow();
  expect(get).not.toHaveBeenCalled();
});

it("refuses missing, inherited, wrong-type or ambiguous metadata wrappers", () => {
  const metadata = encodeMetadataField("a.b.c");
  for (const value of [
    null,
    {},
    { ...metadata, event_type: "other" },
    { ...metadata, extra: 1 },
    { ...metadata, event_payload: {} },
  ])
    expect(() => decodeMetadataField(value)).toThrow();
  const event = encodeEventContent("a.b.c");
  const get = vi.fn(() => event[ENVELOPE_KEY]);
  for (const value of [
    null,
    1,
    {},
    Object.create(event),
    Object.defineProperty({}, ENVELOPE_KEY, { get, enumerable: true }),
    Object.defineProperty({}, ENVELOPE_KEY, { value: event[ENVELOPE_KEY] }),
    { [ENVELOPE_KEY]: {} },
  ])
    expect(() => decodeEventContent(value)).toThrow();
  expect(get).not.toHaveBeenCalled();
});
