// AUTHORED-BY Codex (GPT-6.1 Sol)
import { buildScrobble } from "@jeswr/solid-listening";
import { calendarDay, dailySeries, shiftDay } from "@jeswr/suite-insights";
import { Store } from "n3";
import type { PodSession } from "@/lib/session/pod-session";
import {
  createHealthDataStore,
  loadMeasurements,
  type Measurement,
  seedHealth,
  writeSamples,
} from "../sources/adapters/health";
import {
  createAccount,
  provision,
  seedMoney,
  storeOf,
  type Transaction,
} from "../sources/adapters/money";
import { loadMusic, saveMusic, seedMusic } from "../sources/adapters/music";
export function sampleDays(now: Date) {
  const last = shiftDay(now.toISOString().slice(0, 10), -1);
  return Array.from({ length: 120 }, (_, i) => {
    const day = shiftDay(last, i - 119);
    const weekday = new Date(day).getUTCDay();
    const steps = 4100 + ((i * 37) % 89) * 95;
    return {
      day,
      at: new Date(`${day}T12:00:00Z`),
      steps,
      sleep: Math.round(355 + steps / 185 + ((i * 13) % 17) - 8),
      spending: 12 + (weekday === 0 || weekday === 6 ? 28 : 0) + ((i * 7) % 13),
      listens: Math.round(steps / 1400) + (i % 3),
    };
  });
}
const flights = new WeakMap<PodSession, Promise<void>>();
/** Fictional records enter the same pod and readers as live data; real sessions never write. */
export function ensureSample(session: PodSession, now = new Date()): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const existing = flights.get(session);
  if (existing) return existing;
  const task = seed(session, now).catch((error: unknown) => {
    flights.delete(session);
    throw error;
  });
  flights.set(session, task);
  return task;
}
async function seed(session: PodSession, now: Date) {
  const marker = new URL(".insights-demo-v1.json", session.storageUrl).href;
  const response = await session.fetch(marker, { redirect: "error" });
  let anchor = now;
  let etag: string | null;
  if (response.ok) {
    const saved = await response.json();
    if (saved.complete) return;
    anchor = new Date(saved.at);
    etag = response.headers.get("etag");
  } else {
    if (response.status !== 404) throw new Error("Could not check Insights sample data");
    const reserved = await session.fetch(marker, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify({ at: now.toISOString(), complete: false }),
    });
    if (reserved.status === 412) return seed(session, now);
    if (!reserved.ok) throw new Error("Could not reserve Insights sample data");
    etag = reserved.headers.get("etag");
  }
  if (!etag) throw new Error("Sample data needs a version");
  // Preserve each app's own complete demo (including clinical records and the music library).
  await seedHealth(session, anchor);
  await seedMoney(session, anchor);
  await seedMusic(session, anchor);
  const days = sampleDays(anchor);
  const health = createHealthDataStore(session.fetch, session.storageUrl, session.webId);
  const existingHealth = await loadMeasurements(health, {
    start: new Date(`${days[0]?.day}T00:00:00Z`),
    end: anchor,
  });
  const observed = new Set(existingHealth.map((p) => `${calendarDay(p.at, "UTC")}:${p.kind}`));
  const measurements: Measurement[] = days.flatMap((d) =>
    [
      { kind: "steps" as const, value: d.steps },
      { kind: "sleep" as const, value: d.sleep * 60 },
    ]
      .filter((p) => !observed.has(`${d.day}:${p.kind}`))
      .map((p) => ({
        ...p,
        at: d.at,
        iri: `${health.base}observations/${d.day.slice(0, 7)}.ttl#insights-${d.day}-${p.kind}`,
        source: "Fictional Insights sample",
      })),
  );
  await writeSamples(health, measurements, session.webId, () => {});
  await provision(session);
  const money = storeOf(session);
  const account = money.resolve("accounts/insights-sample.ttl");
  if (!(await money.read(account)).exists)
    await createAccount(session, "insights-sample", {
      name: "Fictional everyday spending",
      type: "cash",
      currency: "GBP",
      openingBalance: "5000",
      date: days[0]?.day as string,
    });
  const transactions: Transaction[] = days.map((d) => ({
    id: `${money.resolve(`transactions/${d.day.slice(0, 7)}.ttl`)}#insights-${d.day}`,
    account: `${account}#account`,
    postingTime: `${d.day}T12:00:00Z`,
    amount: String(-d.spending),
    currency: "GBP",
    description: "Fictional daily spending",
  }));
  await money.saveTransactions(transactions);
  const stepTotals = new Map(
    dailySeries(
      [...existingHealth, ...measurements]
        .filter((p) => p.kind === "steps")
        .map((p) => ({ at: p.at, value: p.value })),
      "UTC",
      "sum",
    ).map((p) => [p.day, p.value as number]),
  );
  const music = new URL("music/", session.storageUrl).href;
  for (const month of new Set(days.map((d) => d.day.slice(0, 7)))) {
    const url = `${music}history/${month}.ttl`;
    const existing = await session.fetch(url, { redirect: "error" });
    if (!existing.ok && existing.status !== 404)
      throw new Error("Could not read sample listening history");
    const document = existing.ok ? await loadMusic(session.fetch, url) : null;
    const quads = [...(document?.dataset ?? [])];
    for (const day of days.filter((d) => d.day.startsWith(month))) {
      const listens =
        Math.round((stepTotals.get(day.day) ?? day.steps) / 1400) + (days.indexOf(day) % 3);
      for (let play = 0; play < listens; play++) {
        // Unique document-shaped bases keep every generated composite's nodes disjoint.
        const base = `${music}insights-${day.day}-${play}`;
        quads.push(
          ...buildScrobble(base, {
            trackTitle: "Morning over Glass Bay",
            artistName: "The Paper Moons",
            playedAt: new Date(day.at.getTime() + play * 240000),
            listener: session.webId,
          }),
        );
      }
    }
    const dataset = new Store(quads);
    // The shared writer handles RDF escaping; app code only composes generated stores.
    if (document && !document.etag) throw new Error("Sample history needs a version");
    await saveMusic(
      session.fetch,
      music,
      url,
      dataset,
      document ? { ifMatch: document.etag as string } : { ifNoneMatch: "*" },
    );
  }
  const done = await session.fetch(marker, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ at: anchor.toISOString(), complete: true }),
  });
  if (!done.ok) throw new Error("Could not finish Insights sample data");
}
