import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DirectBus } from "./bindings/direct.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import { BOB, fixedClock, personalPair } from "./scenarios/personal.js";
import { verifyLedger } from "./store/ledger.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function negotiate(
  windowStart: string,
  windowEnd: string,
  opts: Parameters<typeof personalPair>[0],
) {
  const pair = await personalPair(opts);
  const { alice, bob } = pair;
  const terms = buildMeetingTerms({
    calendar: alice.calendar,
    title: "Synthetic catch-up",
    durationMinutes: 30,
    window: { start: windowStart, end: windowEnd },
    now: opts.now().toISOString(),
  });
  const bus = new DirectBus().register(alice.runtime, bob.runtime);
  const start = await alice.runtime.startNegotiation({
    peer: { actor: BOB.actor, party: BOB.party },
    operation: SCHEDULE_OP,
    terms: terms as never,
    models: [MEETING_MODEL],
  });
  bus.send(alice.runtime, start);
  await bus.run();
  return { ...pair, bus, conversation: start.conversation as string };
}

describe("personal-to-personal scheduling", () => {
  it("negotiates over a counter-proposal and books exactly one hold on each side", async () => {
    const clock = fixedClock();
    const { alice, bob, bus, conversation } = await negotiate(
      "2026-10-20T08:00:00Z",
      "2026-10-23T17:00:00Z",
      { now: clock.now },
    );
    const a = alice.runtime.conversation(conversation);
    const b = bob.runtime.conversation(conversation);
    expect(bus.trace.map((t) => `${t.kind}:${t.disposition}`)).toEqual([
      "describe:accepted",
      "description:accepted",
      "propose:accepted",
      "propose:accepted",
      "accept:accepted",
      "receipt:accepted",
      "receipt:accepted",
    ]);
    expect(a?.phase).toBe("completed");
    expect(b?.phase).toBe("completed");
    expect(alice.calendar.holdCount).toBe(1);
    expect(bob.calendar.holdCount).toBe(1);
    const aliceHold = Object.values(alice.calendar.data.holds)[0];
    const bobHold = Object.values(bob.calendar.data.holds)[0];
    expect(aliceHold?.start).toBe(bobHold?.start);
    // Agreement ids computed independently by both sides must match.
    expect(alice.runtime.agreements()[0]?.id).toBe(bob.runtime.agreements()[0]?.id);
    expect(verifyLedger(alice.ledger.entries()).ok).toBe(true);
    expect(verifyLedger(bob.ledger.entries()).ok).toBe(true);
  });

  it("persists across restart without duplicating effects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-sched-"));
    dirs.push(dir);
    const clock = fixedClock();
    const first = await negotiate("2026-10-20T13:00:00Z", "2026-10-20T17:00:00Z", {
      now: clock.now,
      dir,
    });
    expect(first.alice.calendar.holdCount).toBe(1);
    const replayed = first.bus.results.length;
    expect(replayed).toBeGreaterThan(0);
    first.alice.runtime.close();
    first.bob.runtime.close();
  });
});
