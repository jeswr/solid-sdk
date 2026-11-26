// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { mboxSink } from "./mbox.js";

describe("mbox receiver separator clocks", () => {
  it.each([1, 7, 65536])("preserves each separator date across %i-byte chunks", async (chunk) => {
    const messages: { text: string; date?: Date }[] = [];
    const sink = mboxSink(
      async (raw, date) => {
        messages.push({ text: new TextDecoder().decode(raw), date });
      },
      () => {},
    );
    const input = new TextEncoder().encode(
      "From sender Thu Jan 1 09:00:00 2026\r\nFrom: a@example.test\r\n\r\nbody\r\nFrom sender Fri Jan 2 10:00:00 2026\nFrom: b@example.test\n\n>From body text\n",
    );
    for (let i = 0; i < input.length; i += chunk)
      await sink.push(input.subarray(i, i + chunk), false);
    await sink.push(new Uint8Array(), true);
    expect(messages.map((m) => m.date?.toISOString())).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-01-02T10:00:00.000Z",
    ]);
    expect(messages[1]?.text).toContain("\nFrom body text");
    expect(messages[0]?.text).not.toContain("From sender");
  });
  it("omits malformed and oversized separator dates without dropping the message", async () => {
    const dates: (Date | undefined)[] = [];
    const sink = mboxSink(
      async (_raw, date) => {
        dates.push(date);
      },
      () => {},
    );
    await sink.push(
      new TextEncoder().encode(
        `From sender ${"x".repeat(2000)}\nFrom: a@example.test\n\nbody\nFrom sender invalid\nFrom: b@example.test\n\nbody\n`,
      ),
      true,
    );
    expect(dates).toEqual([undefined, undefined]);
  });
});
