// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory, Parser, Store, Writer } from "n3";
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
import { FEDERATION, FEDERATION_PROPERTIES } from "./federation-vocab.js";
import { type FileImportAdapter, type ImportFile, runFileImport } from "./file-import.js";
import { SectorThing } from "./file-vocab-map.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { PROV, Provenance } from "./provenance.js";
import {
  createMemoryPod,
  fileImport,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import { CLASSES, PodThing, SCHEMA } from "./vocab.js";

const SH = "http://www.w3.org/ns/shacl#";
const RDF_TYPE = DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const RDFS_SUBCLASS = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const sectors = ["media", "finance", "health", "social"];
function loadVocabulary(sector: string, extension: string) {
  return new Parser().parse(
    readFileSync(
      new URL(
        `../../../solid-federation-vocab/sectors/${sector}/${sector}.${extension}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
const sectorShapes = new Store(sectors.flatMap((sector) => loadVocabulary(sector, "shacl.ttl")));
const profiles = new Store([
  ...sectorShapes,
  ...loadVocabulary("core", "shacl.ttl"),
  ...["core", ...sectors].flatMap((sector) => loadVocabulary(sector, "ttl")),
]);

function isSubclassOf(type: Term, target: Term, seen = new Set<string>()): boolean {
  if (type.equals(target)) return true;
  if (seen.has(type.value)) return false;
  seen.add(type.value);
  return profiles
    .getObjects(type, RDFS_SUBCLASS, null)
    .some((parent) => parent.termType === "NamedNode" && isSubclassOf(parent, target, seen));
}

function isInstanceOf(dataset: DatasetCore, subject: Term, target: Term): boolean {
  return [...dataset.match(subject, RDF_TYPE)].some((quad) => isSubclassOf(quad.object, target));
}

/** No shared SHACL helper is exported by the suite. Assert required predicates,
 * cardinalities, datatypes and linked classes, including inherited core shapes.
 * Warning/Info constraints are advisory; this is not a general SHACL engine.
 */
function expectRequiredProfileProperties(dataset: DatasetCore, shapes = profiles): void {
  const subjects = [
    ...new Map([...dataset].map((quad) => [quad.subject.value, quad.subject])).values(),
  ];
  for (const target of shapes.getQuads(null, `${SH}targetClass`, null, null)) {
    const nodes = subjects.filter((subject) => isInstanceOf(dataset, subject, target.object));
    for (const property of profiles.getObjects(target.subject, `${SH}property`, null)) {
      const severity = profiles.getObjects(property, `${SH}severity`, null)[0];
      if (severity && severity.value !== `${SH}Violation`) continue;
      const path = required(profiles.getObjects(property, `${SH}path`, null)[0]);
      for (const subject of nodes) {
        const values = [...dataset.match(subject, path)].map((quad) => quad.object);
        const context = `${subject.value}: ${path.value}`;
        const min = profiles.getObjects(property, `${SH}minCount`, null)[0];
        const max = profiles.getObjects(property, `${SH}maxCount`, null)[0];
        if (min) expect(values.length, context).toBeGreaterThanOrEqual(Number(min.value));
        if (max) expect(values.length, context).toBeLessThanOrEqual(Number(max.value));
        for (const value of values) {
          const datatype = profiles.getObjects(property, `${SH}datatype`, null)[0];
          if (datatype) {
            expect(value.termType, context).toBe("Literal");
            if (value.termType === "Literal") expect(value.datatype.value).toBe(datatype.value);
          }
          const linkedClass = profiles.getObjects(property, `${SH}class`, null)[0];
          if (linkedClass) {
            expect(value.termType, context).toBe("NamedNode");
            expect(isInstanceOf(dataset, value, linkedClass), context).toBe(true);
          }
        }
      }
    }
  }
}

/** Synthetic exports only: no downloaded personal data or source transport. */
const fixtures: {
  adapter: FileImportAdapter;
  name: string;
  text: string;
  types: readonly string[];
  value: string;
  items?: number;
}[] = [
  {
    adapter: appleHealthFileAdapter,
    name: "export.xml",
    text: '<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="10" durationUnit="min" startDate="2026-01-01 12:00:00 +0000"/></HealthData>',
    types: [CLASSES.ExerciseAction, FEDERATION.HealthRecord, FEDERATION.Person],
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
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord, FEDERATION.Activity, FEDERATION.Agent],
    value: "12.50",
  },
  {
    adapter: uberFileAdapter,
    items: 2,
    name: "trips.csv",
    text: "City,Begin Trip Time,Dropoff Address,Fare Amount,Fare Currency\nTestville,2026-01-01 12:00:00,Synthetic Square,8.25,GBP",
    types: [
      CLASSES.TravelAction,
      CLASSES.Invoice,
      FEDERATION.TransactionRecord,
      FEDERATION.Activity,
      FEDERATION.Agent,
    ],
    value: "8.25",
  },
  {
    adapter: whatsappFileAdapter,
    items: 2,
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
    items: 2,
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
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord, FEDERATION.Activity, FEDERATION.Agent],
    value: "-12.50",
  },
  {
    adapter: bankStatementsFileAdapter,
    name: "bank.ofx",
    text: "OFXHEADER:100\r\n<OFX><CURDEF>GBP\r\n<STMTTRN><DTPOSTED>20260120<TRNAMT>-12.50<NAME>Synthetic groceries</STMTTRN></OFX>",
    types: [CLASSES.Invoice, FEDERATION.TransactionRecord, FEDERATION.Activity, FEDERATION.Agent],
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
        // Apply the combined core/sector profile to financial fixtures. Other
        // importers retain sector coverage; core account modelling is separate.
        expectRequiredProfileProperties(
          dataset,
          fixture.types.includes(FEDERATION.TransactionRecord) ? profiles : sectorShapes,
        );
        for (const quad of dataset.match(
          null,
          RDF_TYPE,
          DataFactory.namedNode(FEDERATION.TransactionRecord),
        )) {
          expect(new SectorThing(quad.subject.value, dataset, DataFactory).dataSubject).toBe(
            TEST_WEBID,
          );
        }
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
      if (chunkSize === 7) {
        await expect(`# AUTHORED-BY Codex GPT-6.1-Sol\n${mappings.join("\n")}`).toMatchFileSnapshot(
          `./__snapshots__/${fixture.adapter.metadata.id}-${fixture.name}.ttl`,
        );
      }
      expect(report.state?.lastOutcome).toBe("success");
      expect(report.state?.counts.items).toBe(fixture.items ?? 1);
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

const financialFixtures = fixtures.filter((fixture) =>
  fixture.types.includes(FEDERATION.TransactionRecord),
);

it.each(
  financialFixtures,
)("validates inherited core constraints for $adapter.metadata.id ($name)", async (fixture) => {
  const { pod, report } = await fileImport(
    fixture.adapter,
    streamedFile(fixture.name, fixture.text),
  );
  const written = required(report.written.find((doc) => doc.category === "finance"));
  const dataset = pod.dataset(written.url);
  const recordType = DataFactory.namedNode(FEDERATION.TransactionRecord);
  const record = new SectorThing(
    required([...dataset.match(null, RDF_TYPE, recordType)][0]).subject.value,
    dataset,
    DataFactory,
  );
  expectRequiredProfileProperties(dataset);

  // A sector instance must satisfy core:RecordShape without an explicit core:Record type.
  record.dataSubject = undefined;
  expect(() => expectRequiredProfileProperties(dataset)).toThrow(FEDERATION_PROPERTIES.subject);
  record.dataSubject = TEST_WEBID;

  // Linked-class checks must also follow the core:Person -> core:Agent hierarchy.
  const agent = new PodThing(TEST_WEBID, dataset, DataFactory);
  agent.types.delete(FEDERATION.Agent);
  expect(() => expectRequiredProfileProperties(dataset)).toThrow(FEDERATION_PROPERTIES.subject);
  agent.types.add(FEDERATION.Person);
  expectRequiredProfileProperties(dataset);
});

it.each(
  financialFixtures,
)("uses the host's WebID for $adapter.metadata.id ($name)", async (fixture) => {
  const pod = createMemoryPod();
  const webId = "https://identity.test/synthetic-holder#me";
  const writer = createFetchPodWriter({
    adapterId: fixture.adapter.metadata.id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  expect(writer.webId).toBe(TEST_WEBID);
  const report = await runFileImport({
    adapter: fixture.adapter,
    file: streamedFile(fixture.name, fixture.text),
    podWriter: { ...writer, webId },
  });
  const dataset = pod.dataset(
    required(report.written.find((doc) => doc.category === "finance")).url,
  );
  const records = [
    ...dataset.match(null, RDF_TYPE, DataFactory.namedNode(FEDERATION.TransactionRecord)),
  ];
  expect(records).not.toHaveLength(0);
  for (const record of records)
    expect(new SectorThing(record.subject.value, dataset, DataFactory).dataSubject).toBe(webId);
  expect(new PodThing(webId, dataset, DataFactory).types.has(FEDERATION.Agent)).toBe(true);
  expectRequiredProfileProperties(dataset);
});

it.each([
  undefined,
  "",
  "relative/holder",
  "https://identity.test/invalid holder",
])("refuses financial records without a usable host WebID (%#)", async (webId) => {
  const pod = createMemoryPod();
  const writer = createFetchPodWriter({
    adapterId: bankStatementsFileAdapter.metadata.id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  const file = streamedFile("bank.csv", "Date,Description,Amount\n2026-01-01,Synthetic entry,1");
  await expect(
    runFileImport({ adapter: bankStatementsFileAdapter, file, podWriter: { ...writer, webId } }),
  ).rejects.toThrow("WebID");
  expect(pod.urls().some((url) => url.endsWith("bank-transactions.ttl"))).toBe(false);
});

it.each([
  {
    adapter: goodreadsFileAdapter,
    file: "library.csv",
    text: "Book Id,Title\na/?#<b>,Synthetic book",
    expected: ["https://www.goodreads.com/book/show/a%2F%3F%23%3Cb%3E"],
  },
  {
    adapter: steamFileAdapter,
    file: "games.json",
    text: JSON.stringify({
      games: [{ appid: "a/?#<b>", name: "Synthetic game" }],
      steamid: "a/?#<b>",
    }),
    expected: [
      "https://store.steampowered.com/app/a%2F%3F%23%3Cb%3E",
      "https://steamcommunity.com/profiles/a%2F%3F%23%3Cb%3E",
    ],
  },
  {
    adapter: chatgptFileAdapter,
    file: "conversations.json",
    text: JSON.stringify([{ id: "\ud800", title: "Synthetic chat" }]),
    expected: [],
  },
])("keeps $adapter.metadata.id source identifiers inert", async ({
  adapter,
  file,
  text,
  expected,
}) => {
  const { pod, report } = await fileImport(adapter, streamedFile(file, text));
  const urls = report.written.flatMap((written) =>
    [...pod.dataset(written.url)]
      .filter((quad) => quad.predicate.value === `${SCHEMA}url`)
      .map((quad) => quad.object.value),
  );
  expect(urls).toEqual(expected);
  for (const written of report.written) {
    const dataset = pod.dataset(written.url);
    for (const subject of new Set([...dataset].map((quad) => quad.subject.value))) {
      const item = new Provenance(subject, dataset, DataFactory);
      expect(
        item.derivedFrom.has(item.sourceUrl ?? `urn:solid:connector:${adapter.metadata.id}:export`),
      ).toBe(true);
    }
  }
});

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
