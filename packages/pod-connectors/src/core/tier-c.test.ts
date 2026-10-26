// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { amazonOrdersFileAdapter } from "../amazon-orders/file-adapter.js";
import { appleHealthFileAdapter } from "../apple-health/file-adapter.js";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { chatgptFileAdapter } from "../chatgpt/file-adapter.js";
import { goodreadsFileAdapter } from "../goodreads/file-adapter.js";
import { netflixFileAdapter } from "../netflix/file-adapter.js";
import { steamFileAdapter } from "../steam/file-adapter.js";
import { uberFileAdapter } from "../uber/file-adapter.js";
import { whatsappFileAdapter } from "../whatsapp/file-adapter.js";
import { FEDERATION } from "./federation-vocab.js";
import type { FileImportAdapter, ImportFile } from "./file-import.js";
import { PROV, Provenance } from "./provenance.js";
import { fileImport, TEST_POD_ROOT } from "./testing.js";
import { CLASSES, PodThing, SCHEMA } from "./vocab.js";

/** Synthetic exports only: no downloaded personal data or source transport. */
const fixtures: {
  adapter: FileImportAdapter;
  name: string;
  text: string;
  types: readonly string[];
  value: string;
}[] = [
  {
    adapter: appleHealthFileAdapter,
    name: "export.xml",
    text: '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="10" durationUnit="min" startDate="2026-01-01 12:00:00 +0000"/></HealthData>',
    types: [CLASSES.ExerciseAction, FEDERATION.HealthRecord],
    value: "PT10M",
  },
  {
    adapter: netflixFileAdapter,
    name: "history.csv",
    text: '\uFEFFTitle,Date\r\n"Synthetic café, ""Orbit""\nPart 1",1/20/2026\r\n',
    types: [CLASSES.WatchAction, FEDERATION.ListeningActivity],
    value: 'Synthetic café, "Orbit"\nPart 1',
  },
  {
    adapter: amazonOrdersFileAdapter,
    name: "orders.csv",
    text: 'Order ID,Product Name,Total Owed,Currency\nsynthetic-1,"Synthetic lamp",12.50,GBP\n',
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord],
    value: "12.50",
  },
  {
    adapter: uberFileAdapter,
    name: "trips.csv",
    text: "City,Begin Trip Time,Dropoff Address,Fare Amount,Fare Currency\nTestville,2026-01-01 12:00:00,Synthetic Square,8.25,GBP",
    types: [CLASSES.TravelAction, CLASSES.Invoice, FEDERATION.TransactionRecord],
    value: "8.25",
  },
  {
    adapter: whatsappFileAdapter,
    name: "_chat.txt",
    text: "[20/01/2026, 12:00:00] Synthetic Sender: Hello 🌍\r\ncontinued\r\n[20/01/2026, 12:01:00] Synthetic Peer: Hi",
    types: [CLASSES.Message, FEDERATION.Note],
    value: "Hello 🌍\ncontinued",
  },
  {
    adapter: goodreadsFileAdapter,
    name: "library.csv",
    text: "Book Id,Title,Author,My Rating,Exclusive Shelf\n100,Synthetic Stars,Synthetic Author,4,read",
    types: [CLASSES.Book, FEDERATION.CreativeWork],
    value: "Synthetic Stars",
  },
  {
    adapter: steamFileAdapter,
    name: "games.json",
    text: JSON.stringify({
      response: { games: [{ appid: 100, name: "Synthetic Game", playtime_forever: 75 }] },
      steamid: "12345",
      personaname: "Synthetic Player",
    }),
    types: [
      CLASSES.VideoGame,
      FEDERATION.CreativeWork,
      CLASSES.OnlineAccount,
      FEDERATION.MediaAccount,
    ],
    value: "PT1H15M",
  },
  {
    adapter: chatgptFileAdapter,
    name: "conversations.json",
    text: JSON.stringify({
      ignored: [1, { x: false }],
      conversations: [
        {
          id: "synthetic-1",
          title: "Synthetic chat",
          mapping: {
            m: {
              message: { author: { role: "user" }, content: { parts: ['Synthetic "hello" 🌍'] } },
            },
          },
        },
      ],
    }),
    types: [CLASSES.TextDigitalDocument, FEDERATION.CreativeWork],
    value: 'You: Synthetic "hello" 🌍',
  },
  {
    adapter: bankStatementsFileAdapter,
    name: "bank.csv",
    text: "Date,Description,Amount\n2026-01-20,Synthetic groceries,-12.50",
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord],
    value: "-12.50",
  },
  {
    adapter: bankStatementsFileAdapter,
    name: "bank.ofx",
    text: "OFXHEADER:100\r\n<OFX><CURDEF>GBP\r\n<STMTTRN><DTPOSTED>20260120<TRNAMT>-12.50<NAME>Synthetic groceries</STMTTRN></OFX>",
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord],
    value: "GBP",
  },
];

function streamedFile(name: string, text: string, chunkSize = 7): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: "",
    size: bytes.length,
    text: vi.fn().mockRejectedValue(new Error("Whole-file buffering is forbidden in this test")),
    stream: () => {
      let offset = 0;
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (offset === bytes.length) controller.close();
            else {
              controller.enqueue(bytes.slice(offset, offset + chunkSize));
              offset = Math.min(bytes.length, offset + chunkSize);
            }
          },
        },
        { highWaterMark: 0 },
      );
    },
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture result to exist");
  return value;
}

for (const fixture of fixtures) {
  describe(`${fixture.adapter.metadata.id}: synthetic ${fixture.name}`, () => {
    it.each([
      1, 7, 1024,
    ])("streams %i-byte chunks with sector mapping, provenance and stable re-import", async (chunkSize) => {
      const file = streamedFile(fixture.name, fixture.text, chunkSize);
      const { pod, report } = await fileImport(fixture.adapter, file);
      const types = new Set<string>();
      const values: string[] = [];
      const subjects = new Map<string, string[]>();
      const mappings: string[] = [];
      for (const written of report.written) {
        const dataset = pod.dataset(written.url);
        if (chunkSize === 7) {
          const quads = [...dataset].filter((q) => !q.predicate.value.startsWith(PROV));
          quads.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
          const writer = new Writer({ format: "text/turtle" });
          writer.addQuads(quads);
          mappings.push(
            await new Promise<string>((resolve, reject) => {
              writer.end((error, turtle) => (error ? reject(error) : resolve(turtle)));
            }),
          );
        }
        const itemSubjects = [...new Set([...dataset].map((q) => q.subject.value))];
        subjects.set(written.url, itemSubjects);
        for (const quad of dataset) values.push(quad.object.value);
        for (const subject of itemSubjects) {
          const item = new Provenance(subject, dataset, DataFactory);
          for (const type of item.types) types.add(type);
          expect(item.derivedFrom.size).toBeGreaterThan(0);
          if (item.sourceUrl) expect(item.derivedFrom.has(item.sourceUrl)).toBe(true);
          expect(item.generatedBy.size).toBe(1);
          const activityUrl = required([...item.generatedBy][0]);
          const activity = new Provenance(
            activityUrl,
            pod.dataset(required(activityUrl.split("#")[0])),
            DataFactory,
          );
          expect(activity.types.has(`${PROV}Activity`)).toBe(true);
          expect(activity.startedAt).toBeInstanceOf(Date);
          expect(required(activity.endedAt).getTime()).toBeGreaterThanOrEqual(
            required(activity.startedAt).getTime(),
          );
          expect(activity.associatedWith).toBe(
            `urn:solid:connector:${fixture.adapter.metadata.id}`,
          );
          for (const origin of item.derivedFrom) expect(activity.used.has(origin)).toBe(true);
        }
      }
      expect([...types].sort()).toEqual([...fixture.types].sort());
      expect(values).toContain(fixture.value);
      if (chunkSize === 7) expect(mappings.join("\n")).toMatchSnapshot();
      expect(report.state?.lastOutcome).toBe("success");
      const again = await fileImport(fixture.adapter, file, { pod });
      expect(again.report.state?.counts).toEqual(report.state?.counts);
      for (const written of report.written) {
        expect([...new Set([...pod.dataset(written.url)].map((q) => q.subject.value))]).toEqual(
          subjects.get(written.url),
        );
      }
      const provenanceUrl = `${TEST_POD_ROOT}integrations/${fixture.adapter.metadata.id}/_provenance.ttl`;
      const activitySubjects = new Set([...pod.dataset(provenanceUrl)].map((q) => q.subject.value));
      expect(activitySubjects.size).toBe(2);
      expect(file.text).not.toHaveBeenCalled();
    });
  });
}

it("streams a >50 MiB Apple Health export.xml while retaining only workouts", async () => {
  const encoder = new TextEncoder();
  const ignored = encoder.encode(
    '<Record type="HKQuantityTypeIdentifierStepCount" value="1"/>'.repeat(1024),
  );
  const repeats = 950;
  const start = encoder.encode(
    '<HealthData><!-- <Workout workoutActivityType="fake"/> --><![CDATA[<Workout/>]]><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1"/>',
  );
  const end = encoder.encode(
    '<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="2"/></HealthData>',
  );
  let pulls = 0;
  const file: ImportFile = {
    name: "export.xml",
    type: "application/xml",
    size: start.length + ignored.length * repeats + end.length,
    text: vi.fn().mockRejectedValue(new Error("Must stream")),
    stream: () =>
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulls === 0) controller.enqueue(start);
            else if (pulls <= repeats) controller.enqueue(ignored);
            else if (pulls === repeats + 1) controller.enqueue(end);
            else controller.close();
            pulls++;
          },
        },
        { highWaterMark: 0 },
      ),
  };
  expect(file.size).toBeGreaterThan(50 * 1024 * 1024);
  const { pod, report } = await fileImport(appleHealthFileAdapter, file);
  const dataset = pod.dataset(required(report.written[0]).url);
  const names = [...dataset]
    .filter((q) => q.predicate.value === `${SCHEMA}name`)
    .map((q) => q.object.value);
  expect(names.sort()).toEqual(["Running", "Walking"]);
  expect(
    new PodThing(required(report.written[0]).url, dataset, DataFactory).types.has(
      FEDERATION.HealthRecord,
    ),
  ).toBe(true);
  expect(pulls).toBe(repeats + 3);
  expect(file.text).not.toHaveBeenCalled();
}, 30_000);
