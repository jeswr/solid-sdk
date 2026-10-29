// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, Zip, ZipPassThrough, zipSync } from "fflate";
import { DataFactory } from "n3";
import PostalMime from "postal-mime";
import { describe, expect, it, vi } from "vitest";
import {
  type FileImportAdapter,
  type FileImportContext,
  type ImportFile,
  runFileImport,
} from "../core/file-import.js";
import * as importSessions from "../core/import-session.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { Provenance } from "../core/provenance.js";
import {
  createMemoryPod,
  fileImport,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import type { NormalisedDoc } from "../core/types.js";
import { DriveMetadata } from "../google-drive/vocab.js";
import { pathId } from "../mail/paths.js";
import { MAIL_CLASSES, MailMessage } from "../mail/vocab.js";
import { importFile as nodeImportFile } from "../node/cli.js";
import {
  type ArchiveOptions,
  entryPath,
  importArchive,
  mailboxAccount,
  productFor,
  sniffInput,
} from "./dispatch.js";
import { googleTakeoutFileAdapter } from "./file-adapter.js";
import { mailHeaders, mailLabels, mboxSink, sha256 } from "./mbox.js";
import { readIcs, readVcards } from "./readers.js";
import * as zipReader from "./zip-reader.js";
import {
  cappedSink,
  InflationBudget,
  MAX_ENTRY_BYTES,
  readZip,
  ZIP_PIECE_BYTES,
} from "./zip-reader.js";

const ROOT = `${TEST_POD_ROOT}integrations/google-takeout/`;
const ICAL = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:meeting\r\nSUMMARY:A folded\r\n  summary\r\nDESCRIPTION:Line\\nTwo\r\nLOCATION:Office\r\nDTSTART;TZID=Europe/London:20260612T090000\r\nDTEND;TZID=Europe/London:20260612T100000\r\nRRULE:FREQ=WEEKLY;BYDAY=FR\r\nEXDATE;TZID=Europe/London:20260619T090000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const VCARD = `BEGIN:VCARD\nVERSION:3.0\nUID:contact-1\nFN:Alex Example\nN:Example;Alex;M;Dr;Jr\nEMAIL;TYPE=HOME:alex@example.test\nTEL;TYPE=WORK:+12025550101\nADR;TYPE=HOME:;;10 Street;Town;Region;AB1;UK\nORG:Example;Team\nTITLE:Engineer\nBDAY:1990-06-11\nEND:VCARD\n`;
const RAW = `Delivered-To: alice@example.test\nMessage-ID: <message@example.test>\nFrom: bob@example.test\nTo: alice@example.test\nSubject: Takeout mail\nDate: Fri, 12 Jun 2026 09:00:00 +0000\nX-Gmail-Labels: Inbox,Unread,Starred,"My, folder",Important,Category Social\nX-GM-THRID: 255\n\nHello\n>From body\n`;
const ACTIVITY = JSON.stringify([
  { header: "YouTube", title: "Watched example", time: "2026-06-12T09:00:00Z" },
]);

async function* pieces(bytes: Uint8Array, step = ZIP_PIECE_BYTES) {
  for (let i = 0; i < bytes.length; i += step) yield bytes.subarray(i, i + step);
}
function zipFile(
  entries: Record<string, string | Uint8Array>,
  step = 101,
  level: 0 | 6 = 6,
): ImportFile {
  const zip = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, bytes]) => [
        name,
        typeof bytes === "string" ? strToU8(bytes) : bytes,
      ]),
    ),
    { level },
  );
  return bytesFile(zip, step);
}
function bytesFile(bytes: Uint8Array, step = 101): ImportFile {
  return {
    name: "arbitrary.bin",
    type: "application/octet-stream",
    size: bytes.length,
    text: vi.fn(async () => {
      throw new Error("Archive text() forbidden");
    }),
    slice(start, end) {
      return { stream: () => bytesFile(bytes.subarray(start, end), step).stream!() };
    },
    stream() {
      const iterator = pieces(bytes, step);
      return new ReadableStream({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
      });
    },
  };
}
function context(maxRows = 100_000): FileImportContext & { docs: Map<string, NormalisedDoc> } {
  const docs = new Map<string, NormalisedDoc>();
  return {
    docs,
    maxRows,
    resolve: (slug) => `${ROOT}${slug}`,
    progress: vi.fn(),
    skip: vi.fn(),
    read: vi.fn(async (slug) => docs.get(slug)?.dataset),
    remove: vi.fn(async (slug) => {
      docs.delete(slug);
    }),
    writeBinary: vi.fn(async ({ slug }) => ({ url: `${ROOT}${slug}`, created: true })),
    write: vi.fn(async (doc) => {
      docs.set(doc.slug, doc);
      return { url: `${ROOT}${doc.slug}`, category: doc.category, forClass: doc.forClass };
    }),
  };
}
const allProducts = () => ({
  "Takeout/Mail/All mail.mbox": `From sender Fri Jun 12 09:00:00 2026\n${RAW}`,
  "Takeout/Calendrier/primary.ics": ICAL,
  "Takeout/Contacts/All.vcf": VCARD,
  "Takeout/Drive/a file.ttl": "<unsafe> a <rdf> .",
  "Takeout/YouTube and YouTube Music/history/watch-history.json": ACTIVITY,
  "Takeout/My Activity/Search/MyActivity.json": JSON.stringify([
    { title: "Search example", header: "Search" },
  ]),
  "Takeout/Semantic Location History/2026/2026_JUNE.json": JSON.stringify({
    timelineObjects: [
      {
        placeVisit: {
          location: {
            name: "Park",
            address: "Example Street",
            latitudeE7: 515000000,
            longitudeE7: -1200000,
          },
          duration: {
            startTimestamp: "2026-06-12T09:00:00Z",
            endTimestamp: "2026-06-12T10:00:00Z",
          },
        },
      },
    ],
  }),
  "Takeout/Fit/Daily activity metrics/2026.csv":
    "Date,Step count,Distance (m),Calories (kcal),Heart Points,Move Minutes count\n2026-06-12,1000,750,100,12,10\n",
  "Takeout/Unknown/a.json": "{}",
  "Takeout/Unknown/b.json": "{}",
  "Takeout/Location History/Records.json": "not JSON (never parsed)",
  "Takeout/archive_browser.html": "ignored",
  "Takeout/Empty/": "",
});

function limitedArchive(options: ArchiveOptions): FileImportAdapter {
  return {
    ...googleTakeoutFileAdapter,
    importFile: (file, ctx) => importArchive(file, ctx, undefined, undefined, options),
  };
}

describe("Takeout shared reconciliation budget", () => {
  it("bounds session sources and accounting after releasing product manifests", async () => {
    const rowCounts = [2, 128, 128, 128, 128, 128];
    const file = zipFile(
      Object.fromEntries(
        rowCounts.map((count, entry) => [
          `Takeout/My Activity/Entry-${entry}/MyActivity.json`,
          JSON.stringify(
            Array.from({ length: count }, (_, row) => ({
              title: `Synthetic activity ${row}`,
              titleUrl: `https://source.example/entry-${entry}/item-${row}`,
            })),
          ),
        ]),
      ),
    );
    const pod = createMemoryPod();
    const writer = createFetchPodWriter({
      adapterId: googleTakeoutFileAdapter.metadata.id,
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: pod.fetch,
    });
    const maxRunSources = 5;
    const createImportSession = importSessions.createImportSession;
    const createSession = vi
      .spyOn(importSessions, "createImportSession")
      .mockImplementation((writer, id, source, options, vocabMap) =>
        createImportSession(writer, id, source, { ...options, maxRunSources }, vocabMap),
      );
    const sizes: number[] = [];
    const counts: number[] = [];
    const sourceCounts: number[] = [];
    const limited = limitedArchive({ maxReconciliationSubjects: 3 });
    try {
      const report = await runFileImport({
        adapter: {
          ...limited,
          importFile: (file, ctx) =>
            limited.importFile(file, {
              ...ctx,
              async write(doc) {
                const result = await ctx.write(doc);
                const session = createSession.mock.results[0]?.value;
                if (!session) throw new Error("Expected the file runner's shared session");
                sizes.push(session.itemCounts.size);
                counts.push(session.state({}).counts.items);
                sourceCounts.push(session.used.size);
                expect([...session.itemCounts.keys()]).toEqual(session.written.map((w) => w.url));
                expect([...session.itemCounts.values()]).toEqual(rowCounts.slice(0, sizes.length));
                const dataset = pod.dataset(result.url);
                const subjects = new Set([...doc.dataset].map((q) => q.subject.value));
                expect(subjects.size).toBe(rowCounts[sizes.length - 1]);
                for (const subject of subjects) {
                  const item = new Provenance(subject, dataset, DataFactory);
                  const origin = item.sourceUrl;
                  if (!origin) throw new Error("Expected an item source URL");
                  expect(origin).toMatch(/^https:\/\/source\.example\//);
                  expect(item.derivedFrom.has(origin)).toBe(true);
                  expect(
                    new Provenance(result.url, dataset, DataFactory).derivedFrom.has(origin),
                  ).toBe(true);
                }
                return result;
              },
            }),
        },
        file,
        podWriter: writer,
      });
      // The first entry retains a manifest. The second releases this product's
      // manifests; four more entries must still use only document-level counters.
      expect(report.unsupported).toEqual(["activity: reconciliation-state-cap-exceeded"]);
      expect(report.state?.counts).toEqual({ documents: 6, items: 642, skipped: 1 });
      expect(sizes).toEqual([1, 2, 3, 4, 5, 6]);
      expect(counts).toEqual([2, 130, 258, 386, 514, 642]);
      expect(sourceCounts).toEqual([3, 5, 5, 5, 5, 5]);
      const session = createSession.mock.results[0]?.value;
      if (!session) throw new Error("Expected the file runner's shared session");
      expect(session.used.has("urn:solid:connector:google-takeout:export")).toBe(true);
      expect(session.used.has("https://source.example/entry-5/item-127")).toBe(false);
      const [written] = report.written;
      if (!written) throw new Error("Expected an imported document");
      const first = pod.dataset(written.url);
      const [activityUrl] = [...new Provenance(written.url, first, DataFactory).generatedBy];
      if (!activityUrl) throw new Error("Expected the document's run provenance");
      const run = new Provenance(activityUrl, pod.dataset(`${ROOT}_provenance.ttl`), DataFactory);
      expect([...run.used].sort()).toEqual([...session.used].sort());
      expect(file.text).not.toHaveBeenCalled();
    } finally {
      createSession.mockRestore();
    }
  });

  it("bounds retained subjects across entries and products while other products still reconcile", async () => {
    const calendar = "Takeout/Calendar/a.ics";
    const location = "Takeout/Semantic Location History/2026/2026_JUNE.json";
    const activity = (folder: string) => `Takeout/My Activity/${folder}/MyActivity.json`;
    const simpleIcal = ICAL.replace(/(?:RRULE|EXDATE)[^\r]+\r\n/g, "");
    const initial = {
      [calendar]: simpleIcal,
      "Takeout/Calendar/b.ics": simpleIcal.replace("UID:meeting", "UID:old-second"),
      [activity("A")]: '[{"title":"old A"}]',
      [activity("B")]: '[{"title":"old B"}]',
      [activity("C")]: '[{"title":"old C"}]',
      [location]: allProducts()[location],
    };
    const { pod } = await fileImport(googleTakeoutFileAdapter, zipFile(initial));
    const { report } = await fileImport(
      limitedArchive({ maxReconciliationSubjects: 2 }),
      zipFile({
        [calendar]: simpleIcal.replace("UID:meeting", "UID:new"),
        [activity("A")]: '[{"title":"new A"}]',
        [activity("B")]: '[{"title":"new B"}]',
        [activity("C")]: '[{"title":"new C"}]',
        "Takeout/Calendar/b.ics": simpleIcal.replace("UID:meeting", "UID:new-second"),
        [location]: '{"timelineObjects":[]}',
      }),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(report.unsupported).toEqual(["activity: reconciliation-state-cap-exceeded"]);
    const activities = pod.urls().filter((url) => url.includes("documents/google-activity"));
    expect(activities).toHaveLength(3);
    const titles = activities.flatMap((url) => [...pod.dataset(url)].map((q) => q.object.value));
    for (const suffix of ["A", "B", "C"]) {
      expect(titles).toContain(`old ${suffix}`);
      expect(titles).toContain(`new ${suffix}`);
    }
    const cal = pod.get(`${ROOT}calendar/takeout/Calendar/a.ics.ttl`);
    expect(cal).toContain("#event-new");
    expect(cal).not.toContain("#event-meeting");
    const secondCal = pod.get(`${ROOT}calendar/takeout/Calendar/b.ics.ttl`);
    expect(secondCal).toContain("#event-new-second");
    expect(secondCal).not.toContain("#event-old-second");
    expect(pod.urls().some((url) => url.includes("location/takeout/"))).toBe(false);
  });

  it("counts UTF-8 identifier bytes, and counts a subject only once per document", async () => {
    const file = zipFile({
      "Takeout/Calendar/a.ics": ICAL.replace(/(?:RRULE|EXDATE)[^\r]+\r\n/g, ""),
    });
    const ctx = context();
    ctx.resolve = (slug) => `${ROOT}é/${slug}`;
    const identifier = `NamedNode:${ctx.resolve("calendar/takeout/Calendar/a.ics.ttl")}#event-meeting`;
    const bytes = strToU8(identifier).length;
    expect(bytes).toBeGreaterThan(identifier.length);
    expect(
      await importArchive(file, ctx, undefined, undefined, {
        maxReconciliationSubjects: 1,
        maxReconciliationBytes: bytes,
      }),
    ).toMatchObject({ skipped: undefined });
    const capped = await importArchive(file, ctx, undefined, undefined, {
      maxReconciliationBytes: bytes - 1,
    });
    expect(capped).toMatchObject({
      skipped: 1,
      unsupported: ["calendar: reconciliation-state-cap-exceeded"],
    });
  });

  it("merges contacts membership without retaining further identifiers after the shared cap", async () => {
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/old.vcf": VCARD }),
    );
    const { report } = await fileImport(
      limitedArchive({ maxReconciliationSubjects: 1 }),
      zipFile({
        "Takeout/Contacts/a.vcf": VCARD.replace("contact-1", "contact-2").replace(
          "Alex Example",
          "Second Example",
        ),
        "Takeout/Contacts/b.vcf": VCARD.replace("contact-1", "contact-3").replace(
          "Alex Example",
          "Third Example",
        ),
        "Takeout/Contacts/c.vcf": VCARD.replace("contact-1", "contact-4").replace(
          "Alex Example",
          "Fourth Example",
        ),
      }),
      { pod },
    );
    expect(report).toMatchObject({
      skipped: 1,
      unsupported: ["contacts: reconciliation-state-cap-exceeded"],
    });
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toHaveLength(4);
    const index = pod.get(`${ROOT}contacts/people.ttl`);
    for (const name of ["Alex", "Second", "Third", "Fourth"])
      expect(index).toContain(`${name} Example`);
  });

  it.each([
    0, 1, 100,
  ])("enforces contact rows across entries with an identifier budget of %i", async (maxReconciliationSubjects) => {
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/old.vcf": VCARD }),
    );
    const card = (n: number) =>
      VCARD.replace("contact-1", `new-contact-${n}`).replace("Alex Example", `Contact ${n}`);
    let personWrites = 0;
    let membershipWrites = 0;
    const adapter: FileImportAdapter = {
      ...googleTakeoutFileAdapter,
      importFile: (file, ctx) =>
        importArchive(
          file,
          {
            ...ctx,
            maxRows: 3,
            write(doc, conditions) {
              if (doc.slug.startsWith("contacts/Person/")) personWrites++;
              if (doc.slug === "contacts/people.ttl") membershipWrites++;
              return ctx.write(doc, conditions);
            },
          },
          undefined,
          undefined,
          { maxReconciliationSubjects },
        ),
    };
    const { report } = await fileImport(
      adapter,
      zipFile({
        "Takeout/Contacts/a.vcf": card(1) + card(2),
        "Takeout/Contacts/b.vcf": card(3) + card(4),
        "Takeout/Contacts/c.vcf": card(5),
      }),
      { pod },
    );
    const capped = maxReconciliationSubjects < 3;
    expect(report.skipped).toBe(capped ? 3 : 2);
    expect(personWrites).toBe(3);
    expect(membershipWrites).toBe(capped ? 3 : 1);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toHaveLength(4);
    const index = pod.get(`${ROOT}contacts/people.ttl`);
    for (const name of ["Alex Example", "Contact 1", "Contact 2", "Contact 3"])
      expect(index).toContain(name);
    for (const name of ["Contact 4", "Contact 5"]) expect(index).not.toContain(name);
  });

  it.each([
    0, 100,
  ])("counts duplicate contacts toward the row ceiling with identifier budget %i", async (maxReconciliationSubjects) => {
    const ctx = context(2);
    const report = await importArchive(
      zipFile({
        "Takeout/Contacts/a.vcf": VCARD,
        "Takeout/Contacts/b.vcf": VCARD,
        "Takeout/Contacts/c.vcf": VCARD,
      }),
      ctx,
      undefined,
      undefined,
      { maxReconciliationSubjects },
    );
    const writes = vi.mocked(ctx.write).mock.calls.map(([doc]) => doc.slug);
    expect(writes.filter((slug) => slug.startsWith("contacts/Person/"))).toHaveLength(2);
    expect(report.skipped).toBe(maxReconciliationSubjects === 0 ? 2 : 1);
    expect(ctx.remove).not.toHaveBeenCalled();
  });
});

describe("Takeout archive products", () => {
  it("imports every supported product and reports unknown products and raw points", async () => {
    const file = zipFile(allProducts(), 17);
    const { pod, report } = await fileImport(googleTakeoutFileAdapter, file);
    expect(report.categories.sort()).toEqual([
      "calendar",
      "contacts",
      "documents",
      "health",
      "mail",
      "media",
      "mobility",
    ]);
    expect(report.unsupported).toEqual([
      "Location History: Records.json (raw points unsupported)",
      "Unknown",
    ]);
    expect(report.skipped).toBeUndefined();
    expect(file.text).not.toHaveBeenCalled();
    const binary = `${ROOT}drive/takeout/a~20file.ttl`;
    expect(pod.contentType(binary)).toBe("application/octet-stream");
    expect(new TextDecoder().decode(pod.bytes(binary))).toBe("<unsafe> a <rdf> .");
    const mailUrl = `${ROOT}mail/${pathId("alice@example.test")}/messages/${pathId("<message@example.test>")}.ttl`;
    const mail = new MailMessage(`${mailUrl}#it`, pod.dataset(mailUrl), DataFactory);
    expect(mail.types.has(MAIL_CLASSES.EmailMessage)).toBe(true);
    expect(mail.dateRead).toBeUndefined();
    expect(mail.partOfThread).toContain("gmail-ff.ttl");
    expect([...mail.folderIris]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("system:inbox"),
        expect.stringContaining("system:starred"),
        expect.stringContaining("My~2C~20folder"),
      ]),
    );
    expect(new TextDecoder().decode(pod.bytes(mailUrl.replace(/\.ttl$/, ".eml")))).toContain(
      "\nFrom body\n",
    );
    const calendar = pod.get(`${ROOT}calendar/takeout/Calendrier/primary.ics.ttl`);
    expect(calendar).toContain("A folded summary");
    expect(calendar).toContain("RecurrenceRule");
    expect(calendar).toContain("2026-06-12T08:00:00Z");
    expect(pod.get(`${ROOT}contacts/index.ttl`)).toContain("AddressBook");
    expect(pod.get(`${ROOT}health/takeout/Fit/Daily~20activity~20metrics/2026.csv.ttl`)).toContain(
      "heart-points",
    );
  });

  it("reimports identical data and replaces changed product documents", async () => {
    const file = zipFile(allProducts());
    const { pod } = await fileImport(googleTakeoutFileAdapter, file);
    const normalized = () =>
      Object.fromEntries(
        pod
          .urls()
          .filter((url) => url.startsWith(ROOT) && !url.endsWith("_provenance.ttl"))
          .map((url) => [
            url,
            pod.bytes(url)
              ? [...pod.bytes(url)!]
              : [...pod.dataset(url)]
                  .filter((q) => !q.predicate.value.startsWith("http://www.w3.org/ns/prov#"))
                  .map((q) => JSON.stringify(q))
                  .sort(),
          ]),
      );
    const before = normalized();
    await fileImport(googleTakeoutFileAdapter, file, { pod });
    expect(normalized()).toEqual(before);
    const updated = allProducts();
    updated["Takeout/Calendrier/primary.ics"] = ICAL.replace("A folded", "Changed").replace(
      "LOCATION:Office\r\n",
      "",
    );
    await fileImport(googleTakeoutFileAdapter, zipFile(updated), { pod });
    const cal = pod.get(`${ROOT}calendar/takeout/Calendrier/primary.ics.ttl`);
    expect(cal).toContain("Changed summary");
    expect(cal).not.toContain("Office");
    await fileImport(googleTakeoutFileAdapter, zipFile({ "Takeout/Contacts/All.vcf": "" }), {
      pod,
    });
    expect(pod.get(`${ROOT}contacts/people.ttl`)).not.toContain("Alex");
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toEqual([]);
  });

  it("surfaces unsupported-only exports as a successful honest report", async () => {
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Unknown/file.bin": "" }),
    );
    expect(report.unsupported).toEqual(["Unknown"]);
    expect(report.written).toEqual([]);
  });
});

describe("Takeout untrusted paths and classification", () => {
  it.each([
    "../Takeout/Drive/x",
    "/Takeout/Drive/x",
    "Takeout/Drive/../x",
    "Takeout/Drive/./x",
    "Takeout/Drive//x",
    "Takeout/Drive/ ",
    "Takeout/Drive/\\x",
    "Takeout/Drive/\x00x",
    `Takeout/${"a/".repeat(16)}x`,
    "Takeout/Drive/\ud800",
  ])("rejects %s", (name) => expect(entryPath(name)).toBeUndefined());
  it.each([
    ["Drive/a.ics", "drive"],
    ["Courrier/all.MBOX", "mail"],
    ["Calendrier/a.ICS", "calendar"],
    ["Personnes/a.VCF", "contacts"],
    ["My Activity/YouTube/MyActivity.json", "activity"],
    ["YouTube and YouTube Music/history/watch-history.json", "activity"],
    ["Semantic Location History/2026/2026_JUNE.json", "location"],
    ["Location History/Records.json", "raw-location"],
    ["Records.json", "raw-location"],
    ["Fit/Daily activity metrics/d.csv", "fit"],
    ["other/x", "unsupported"],
  ])("dispatches %s by signal", (path, product) => expect(productFor(path)).toBe(product));
  it("escapes every Drive segment and never fetches file URLs", async () => {
    const ctx = context();
    await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Drive/a?/#https:%2f.txt": "https://untrusted.example" }),
      ctx,
    );
    expect(ctx.writeBinary).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "drive/takeout/a~3F/~23https~3A~252f.txt" }),
    );
    expect(ctx.docs.size).toBe(1);
  });
  it("reports invalid archive paths and ignores browser html", async () => {
    const ctx = context();
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Drive/../x": "bad", "archive_browser.html": "ignored" }),
      ctx,
    );
    expect(report).toMatchObject({
      skipped: 1,
      unsupported: ["(invalid path): unsafe-entry-path"],
    });
  });
});

describe("mboxrd and labels", () => {
  it.each([
    "\n",
    "\r\n",
  ])("splits across every byte with %j and removes one quote", async (newline) => {
    const messages: string[] = [];
    const skip = vi.fn();
    const sink = mboxSink(async (raw) => {
      messages.push(new TextDecoder().decode(raw));
    }, skip);
    const text = [
      "From sender date",
      "Subject: First",
      "",
      ">From body",
      ">>From quoted",
      "From sender date",
      "Subject: Second",
      "",
      "tail",
    ].join(newline);
    for (const byte of strToU8(text)) await sink.push(new Uint8Array([byte]), false);
    await sink.push(new Uint8Array(), true);
    expect(messages).toEqual([
      `Subject: First${newline}${newline}From body${newline}>From quoted${newline}`,
      `Subject: Second${newline}${newline}tail`,
    ]);
    expect(skip).not.toHaveBeenCalled();
  });
  it("skips each oversized message while keeping later messages", async () => {
    const messages: Uint8Array[] = [];
    const skip = vi.fn();
    const sink = mboxSink(
      async (raw) => {
        messages.push(raw);
      },
      skip,
      12,
    );
    await sink.push(
      strToU8(
        `From sender\n${"x".repeat(100_000)}\nFrom sender\n${">".repeat(100)}\nFrom sender\nSubject: x`,
      ),
      true,
    );
    expect(skip).toHaveBeenCalledTimes(2);
    expect(messages.map((raw) => new TextDecoder().decode(raw))).toEqual(["Subject: x"]);
  });
  it("handles empty messages, prefixes at EOF, no envelope and block boundaries", async () => {
    for (const text of ["", "From ", "From sender\n", "Fro", ">", "plain", "x".repeat(9000)]) {
      const messages: Uint8Array[] = [];
      await mboxSink(
        async (raw) => {
          messages.push(raw);
        },
        () => {},
      ).push(strToU8(text), true);
      expect(messages.length).toBe(text && !text.startsWith("From ") ? 1 : 0);
    }
  });
  it("uses the shared Gmail system label map and handles quoted custom folders", () => {
    expect(
      mailLabels(
        'Sent,Drafts,Trash,Starred,Opened,Archived,Important,Category Promotions,"A, B","quoted ""name""",.,..',
      ),
    ).toEqual({
      folders: [
        { key: "Sent", title: "Sent" },
        { key: "Drafts", title: "Drafts" },
        { key: "Trash", title: "Trash" },
        { key: "Starred", title: "Starred" },
        { key: "A, B", title: "A, B" },
        { key: 'quoted "name"', title: 'quoted "name"' },
      ],
      read: true,
      spam: false,
    });
    expect(mailLabels("").folders).toEqual([{ key: "Archive", title: "Archive" }]);
    expect(mailLabels("Archived,Unread,Spam")).toMatchObject({ read: false, spam: true });
  });
  it("unfolds headers and preserves the first duplicate", () => {
    const headers = mailHeaders(
      strToU8("Invalid\nX-Gmail-Labels: Inbox,\n Unread\nX-Gmail-Labels: Sent\n\nBody"),
    );
    expect(headers.get("x-gmail-labels")).toBe("Inbox, Unread");
  });
  it("hashes deterministically", async () => {
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256(strToU8("abc"))).toBe(await sha256("abc"));
  });
  it("skips Spam and malformed MIME, falls back for absent account/id/thread", async () => {
    const ctx = context();
    const spam = RAW.replace("Inbox,Unread,Starred", "Spam").replace(/^Delivered-To:.*\n/, "");
    const noId = RAW.replace(/^Delivered-To:.*\n/, "")
      .replace(/^Message-ID:.*\n/m, "")
      .replace("X-GM-THRID: 255", "X-GM-THRID: invalid");
    const result = await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Mail/x.mbox": `From a\n${spam}\nFrom a\n${noId}\nFrom a\nnot mail` }),
      ctx,
    );
    expect(result).toMatchObject({ skipped: 1 });
    expect(
      [...ctx.docs.keys()].some((slug) => slug.includes("mail/google-takeout/messages/takeout-")),
    ).toBe(true);
  });
});

describe("RFC readers", () => {
  it("reads folded calendars, parameters, all-day dates, recurrence overrides and cancellation", () => {
    const event = readIcs(ICAL, 100)[0];
    expect(event).toMatchObject({
      id: "meeting",
      summary: "A folded summary",
      description: "Line\nTwo",
      location: "Office",
      start: { dateTime: "2026-06-12T09:00:00", timeZone: "Europe/London" },
    });
    const extra = `BEGIN:VCALENDAR\nBROKEN\nBEGIN:VTODO\nSUMMARY:Ignore\nEND:VTODO\nBEGIN:VEVENT\nUID:all\nDTSTART;VALUE=DATE:20260612\nDTEND;VALUE=DATE:20260613\nRECURRENCE-ID;VALUE=DATE:20260612\nSTATUS:CANCELLED\nBEGIN:VALARM\nSUMMARY:Alarm\nEND:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nUID:bad\nDTSTART:bad\nSTATUS:TENTATIVE\nEND:VEVENT\nEND:VCALENDAR`;
    expect(readIcs(extra, 100)).toEqual([
      {
        id: "all-2026-06-12",
        status: "cancelled",
        recurringEventId: "all",
        start: { date: "2026-06-12" },
        end: { date: "2026-06-13" },
        originalStartTime: { date: "2026-06-12" },
      },
      { id: "bad", status: "confirmed", start: undefined },
    ]);
    expect(
      readIcs(
        "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20260612T090000Z\nDTEND:20260612T100000Z\nRECURRENCE-ID:20260612T090000Z\nEND:VEVENT\nEND:VCALENDAR",
        1,
      )[0].id,
    ).toBe("a-2026-06-12T09:00:00Z");
    expect(() => readIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT", 1)).toThrow(/Incomplete/);
    expect(() => readIcs(ICAL, 0)).toThrow(/cap/);
    expect(() => readIcs("nonsense", 1)).toThrow(/calendar component/);
  });
  it("reads vCard 3 and 4, grouped fields, QP charsets, folding and yearless birthdays", async () => {
    const [v3] = await readVcards(VCARD, 100);
    expect(v3.id).toBe(`takeout-${await sha256("contact-1")}`);
    expect(v3.person.names?.[0]).toMatchObject({
      displayName: "Alex Example",
      givenName: "Alex",
      familyName: "Example",
    });
    const v4 = `ignored\nBEGIN:VCARD\nVERSION:4.0\nFN;ENCODING=QUOTED-PRINTABLE;CHARSET="ISO-8859-1":Andr=E9=\n Example\nitem1.EMAIL;HOME:mailto:andre@example.test\nTEL;TYPE="work:voice":tel:+123456\nN:Example;Andr=E9;;;\nTITLE:First\nORG:Company\nTITLE:Second\nADR:;;Main\\;Street;City;;;Country\nBDAY:--0612\nEND:VCARD\n`;
    const first = await readVcards(v4, 100);
    expect(first[0].person.names?.[0].displayName).toBe("André Example");
    expect(first[0].person.emailAddresses).toEqual([{ value: "andre@example.test", type: "home" }]);
    expect(first[0].person.phoneNumbers).toEqual([{ value: "+123456", type: "work:voice" }]);
    expect(first[0].person.birthdays).toEqual([{ date: { year: 0, month: 6, day: 12 } }]);
    expect(first[0].person.organizations?.[0].title).toBe("Second");
    expect(await readVcards(v4, 100)).toEqual(first);
    await expect(readVcards("BEGIN:VCARD\nBDAY:invalid\nEND:VCARD", 1)).resolves.toHaveLength(1);
    await expect(readVcards(VCARD, 0)).rejects.toThrow(/cap/);
    await expect(readVcards("BEGIN:VCARD", 1)).rejects.toThrow(/Incomplete/);
    await expect(readVcards("not a card", 1)).rejects.toThrow(/vCard/);
    await expect(
      readVcards("BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:a=3Db=ZZ\nEND:VCARD", 1),
    ).resolves.toMatchObject([{ person: { names: [{ displayName: "a=b=ZZ" }] } }]);
  });
});

describe("zip streaming and bounds", () => {
  it("awaits downstream processing before obtaining another compressed piece", async () => {
    const zip = zipSync({ "Takeout/Drive/a": new Uint8Array(180_000) }, { level: 0 });
    let outstanding = false;
    const input = bytesFile(zip);
    const slice = input.slice!;
    input.slice = (start, end) => {
      expect(outstanding).toBe(false);
      return slice(start, end);
    };
    let bytes = 0;
    await readZip(input, {
      entry: () => ({
        async push(chunk) {
          outstanding = true;
          await Promise.resolve();
          bytes += chunk.length;
          outstanding = false;
        },
      }),
      skip: () => {},
    });
    expect(bytes).toBe(180_000);
  });
  it("streams a >50 MiB archive generated without retaining the archive or inflated entry", async () => {
    const size = 51 * 1024 * 1024;
    let generated = 0;
    let consumed = 0;
    let maximum = 0;
    let queued: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      queued.push(chunk);
    });
    const entry = new ZipPassThrough("Takeout/Unknown/large.bin");
    zip.add(entry);
    const directory = await mkdtemp(join(tmpdir(), "takeout-bound-"));
    const path = join(directory, "large.zip");
    const handle = await open(path, "w");
    try {
      while (generated < size) {
        entry.push(new Uint8Array(ZIP_PIECE_BYTES), false);
        generated += ZIP_PIECE_BYTES;
        for (const chunk of queued) await handle.write(chunk);
        queued = [];
      }
      entry.push(new Uint8Array(), true);
      zip.end();
      for (const chunk of queued) await handle.write(chunk);
    } finally {
      await handle.close();
    }
    try {
      const file = await nodeImportFile(path, googleTakeoutFileAdapter);
      expect(file.size).toBeGreaterThan(50 * 1024 * 1024);
      await readZip(file, {
        entry: () => ({
          async push(bytes) {
            await Promise.resolve();
            consumed += bytes.length;
          },
        }),
        skip: () => {},
        pendingBytes(bytes) {
          maximum = Math.max(maximum, bytes);
        },
      });
    } finally {
      await rm(directory, { recursive: true });
    }
    expect(consumed).toBeGreaterThan(50 * 1024 * 1024);
    expect(maximum).toBeLessThanOrEqual(ZIP_PIECE_BYTES);
    expect(queued.reduce((sum, bytes) => sum + bytes.length, 0)).toBeLessThan(1024);
  }, 30000);
  it("bounds a highly compressed inflated piece and whole-entry buffers", async () => {
    const zip = zipSync({ "Takeout/Drive/large.bin": new Uint8Array(2 * 1024 * 1024) });
    let maximum = 0;
    let calls = 0;
    await readZip(bytesFile(zip), {
      entry: () =>
        cappedSink(1024, async (bytes, size) => {
          expect(bytes).toBeUndefined();
          expect(size).toBe(2 * 1024 * 1024);
          calls++;
        }),
      skip: () => {},
      pendingBytes(bytes) {
        maximum = Math.max(maximum, bytes);
      },
    });
    expect(calls).toBe(1);
    expect(maximum).toBeLessThan(70 * 1024 * 1024);
    const complete = vi.fn(async () => {});
    const sink = cappedSink(3, complete);
    await sink.push(strToU8("ab"), false);
    await sink.push(strToU8("c"), true);
    expect(complete).toHaveBeenCalledWith(strToU8("abc"), 3);
    const exceeded = cappedSink(1, complete);
    await exceeded.push(strToU8("ab"), false);
    await exceeded.push(strToU8("c"), true);
    expect(complete).toHaveBeenLastCalledWith(undefined, 3);
  });
  it.each([
    0, 6,
  ] as const)("skips encrypted entries without parsing content, method %s", async (level) => {
    const zip = zipSync({ "Takeout/Contacts/a.vcf": strToU8(VCARD) }, { level });
    zip[6] |= 1;
    for (let i = 0; i + 46 <= zip.length; i++)
      if (new DataView(zip.buffer).getUint32(i, true) === 0x02014b50) zip[i + 8] |= 1;
    const ctx = context();
    expect(await googleTakeoutFileAdapter.importFile(bytesFile(zip, 1), ctx)).toMatchObject({
      skipped: 1,
      unsupported: ["Contacts: encrypted-entry"],
    });
    expect(ctx.docs.size).toBe(0);
  });
  it("reports unsupported compression and continues", async () => {
    const zip = zipSync(
      { "Takeout/Unknown/a": strToU8("x"), "Takeout/Unknown/b": strToU8("y") },
      { level: 0 },
    );
    zip[8] = 99;
    for (let i = 0; i + 46 <= zip.length; i++)
      if (new DataView(zip.buffer).getUint32(i, true) === 0x02014b50) {
        zip[i + 10] = 99;
        break;
      }
    const skip = vi.fn();
    const push = vi.fn(async () => {});
    await readZip(bytesFile(zip, 2), { entry: () => ({ push }), skip });
    expect(skip).toHaveBeenCalledWith("Takeout/Unknown/a", "unsupported-compression");
    expect(push).toHaveBeenCalled();
  });
  it("counts entry and total inflated cap breaches without buffering skipped entries", async () => {
    const zip = zipSync(
      { a: strToU8("abcd"), b: strToU8("abcd"), c: strToU8("abcd") },
      { level: 0 },
    );
    const skip = vi.fn();
    await readZip(bytesFile(zip, 1), {
      entry: () => ({ push: async () => {} }),
      skip,
      maxTotalBytes: 3,
      maxEntries: 3,
    });
    expect(skip.mock.calls).toEqual([
      ["a", "total-inflated-cap-exceeded"],
      ["b", "total-inflated-cap-exceeded"],
      ["c", "total-inflated-cap-exceeded"],
    ]);
  });
  it("cancels and releases the input stream after a downstream failure", async () => {
    const file = zipFile({ "Takeout/Drive/file.txt": "bytes" });
    const cancel = vi.fn();
    const wrapped = {
      ...file,
      slice(start: number, end: number) {
        const read = file.slice!(start, end).stream().getReader();
        return {
          stream: () =>
            new ReadableStream({
              async pull(controller) {
                const next = await read.read();
                if (next.done) controller.close();
                else controller.enqueue(next.value);
              },
              cancel,
            }),
        };
      },
    };
    const ctx = context();
    ctx.writeBinary = vi.fn(async () => {
      throw new Error("Pod unavailable");
    });
    await expect(googleTakeoutFileAdapter.importFile(wrapped, ctx)).rejects.toThrow(
      "Pod unavailable",
    );
    expect(cancel).not.toHaveBeenCalled();
  });
  it("rejects incomplete compressed entries", async () => {
    const zip = zipSync({ a: strToU8("a".repeat(1000)) });
    await expect(
      readZip(bytesFile(zip.subarray(0, 40)), {
        entry: () => ({ push: async () => {} }),
        skip: () => {},
      }),
    ).rejects.toThrow();
  });
  it("sniffs split signatures and supports legacy JSON streaming independently of names", async () => {
    expect((await sniffInput(bytesFile(strToU8(ACTIVITY), 1))).zip).toBe(false);
    const ctx = context();
    await googleTakeoutFileAdapter.importFile(bytesFile(strToU8(ACTIVITY), 1), ctx);
    expect(ctx.docs.size).toBe(1);
    expect(await sniffInput(bytesFile(new Uint8Array()))).toEqual({ zip: false, text: "" });
    const text = vi.fn(async () => "");
    await expect(sniffInput({ name: "export.zip", size: 1, type: "", text })).rejects.toThrow(
      /stream/,
    );
    expect(text).not.toHaveBeenCalled();
    await expect(sniffInput(memoryFile("export.json", "PK\x03\x04"))).rejects.toThrow(/stream/);
    await expect(
      sniffInput({ ...memoryFile("x.json", ""), size: MAX_ENTRY_BYTES + 1 }),
    ).rejects.toThrow(/limit/);
    expect((await sniffInput(memoryFile("x", ACTIVITY, "application/json"))).zip).toBe(false);
  });
});

describe("Takeout failure and cap reporting", () => {
  it("keeps only metadata for oversized Drive files, removing a stale binary", async () => {
    const ctx = context();
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Drive/large.unknown": new Uint8Array(25 * 1024 * 1024 + 1) }),
      ctx,
    );
    expect(report).toMatchObject({ skipped: 1 });
    expect(ctx.writeBinary).not.toHaveBeenCalled();
    expect(ctx.remove).toHaveBeenCalledWith("drive/takeout/large.unknown");
    const slug = "drive/takeout-meta/large.unknown.ttl";
    const meta = new DriveMetadata(`${ROOT}${slug}#it`, ctx.docs.get(slug)!.dataset, DataFactory);
    expect(meta.contentSkipped).toBe("size-cap-exceeded");
    expect(meta.contentSize).toBe(String(25 * 1024 * 1024 + 1));
    expect(meta.encodingFormat).toBe("application/octet-stream");
    expect([...meta.encodings]).toEqual([]);
  }, 30000);
  it("skips a whole JSON entry over 64 MiB and an mbox message over Gmail's cap", async () => {
    const oversized = new Uint8Array(MAX_ENTRY_BYTES + 1);
    const ctx = context();
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({
        "Takeout/My Activity/Search/MyActivity.json": oversized,
        "Takeout/Contacts/oversized.vcf": oversized,
        "Takeout/Mail/a.mbox": new Uint8Array(36 * 1024 * 1024 + 1).fill(120),
      }),
      ctx,
    );
    expect(report).toMatchObject({ skipped: 3 });
    expect(ctx.docs.size).toBe(0);
  }, 60000);
  it("counts malformed entries and row breaches while retaining valid products", async () => {
    const ctx = context(1);
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({
        "Takeout/Contacts/broken.vcf": "BEGIN:VCARD",
        "Takeout/Calendar/broken.ics": "BEGIN:VEVENT",
        "Takeout/My Activity/Search/MyActivity.json": "not json",
        "Takeout/My Activity/Other/MyActivity.json": "{}",
        "Takeout/Semantic Location History/2026/2026_JUNE.json": "not json",
        "Takeout/Fit/Daily activity metrics/x.csv": "Date\n2026-06-12\n2026-06-13",
        "Takeout/My Activity/YouTube/MyActivity.json": JSON.stringify([
          { title: "one" },
          { title: "two" },
        ]),
        "Takeout/Contacts/a.vcf": VCARD,
        "Takeout/Contacts/duplicate.vcf": VCARD,
        "Takeout/Contacts/b.vcf": VCARD.replace("contact-1", "contact-2"),
      }),
      ctx,
    );
    expect(report).toMatchObject({ skipped: 9 });
    expect([...ctx.docs.keys()].filter((slug) => slug.startsWith("contacts/Person/"))).toHaveLength(
      1,
    );
  });
  it("uses only the first message header for Delivered-To, and flushes shared thread keys", async () => {
    const ctx = context();
    const first = RAW.replace(/^Delivered-To:.*\n/, "Delivered-To: invalid\n");
    await googleTakeoutFileAdapter.importFile(
      zipFile({
        "Takeout/Mail/all.mbox": `From a\n${first}\nFrom b\n${RAW.replace("<message@", "<second@")}`,
      }),
      ctx,
    );
    expect([...ctx.docs.keys()].filter((slug) => slug.includes("/messages/"))).toHaveLength(2);
    expect([...ctx.docs.keys()].every((slug) => slug.startsWith("mail/google-takeout/"))).toBe(
      true,
    );
    expect([...ctx.docs.keys()].filter((slug) => slug.includes("/threads/"))).toEqual([
      `mail/google-takeout/threads/gmail-ff.ttl`,
    ]);
  });
  it("skips MailParseError and propagates Pod errors", async () => {
    const file = zipFile({ "Takeout/Mail/a.mbox": `From sender\n${RAW}` });
    const spy = vi.spyOn(PostalMime, "parse").mockRejectedValueOnce(new Error("bad MIME"));
    try {
      expect(await googleTakeoutFileAdapter.importFile(file, context())).toMatchObject({
        skipped: 1,
      });
    } finally {
      spy.mockRestore();
    }
    const ctx = context();
    ctx.writeBinary = vi.fn(async () => {
      throw new Error("Pod failure");
    });
    await expect(googleTakeoutFileAdapter.importFile(file, ctx)).rejects.toThrow("Pod failure");
  });
  it("aborts malformed DEFLATE before importing the next entry", async () => {
    const zip = zipSync({
      "Takeout/Drive/bad.txt": strToU8("bad bad bad"),
      "Takeout/Drive/good.txt": strToU8("good"),
    });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const offset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    zip[offset] = 7;
    const ctx = context();
    await expect(googleTakeoutFileAdapter.importFile(bytesFile(zip), ctx)).rejects.toThrow(
      /ZIP decoder failed/,
    );
    expect(ctx.write).not.toHaveBeenCalled();
    expect(ctx.writeBinary).not.toHaveBeenCalled();
  });
  it("rejects genuinely oversized legacy input and cancels the streamed input", async () => {
    await expect(
      sniffInput({ ...memoryFile("x.json", "x".repeat(MAX_ENTRY_BYTES + 1)), size: 1 }),
    ).rejects.toThrow(/limit/);
    const cancel = vi.fn();
    let chunks = 0;
    const file: ImportFile = {
      name: "x.json",
      type: "",
      size: 1,
      text: async () => "",
      stream: () =>
        new ReadableStream(
          {
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024).fill(120));
              chunks++;
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
    };
    await expect(sniffInput(file)).rejects.toThrow(/limit/);
    expect(chunks).toBe(65);
    expect(cancel).toHaveBeenCalled();
  }, 30000);
  it("requires ranged reads for ZIPs and rejects missing directories", async () => {
    const file = zipFile({ "Takeout/Unknown/x": "x" });
    await expect(
      googleTakeoutFileAdapter.importFile({ ...file, slice: undefined }, context()),
    ).rejects.toThrow(/slice/);
    await expect(
      googleTakeoutFileAdapter.importFile(
        bytesFile(zipSync({ a: strToU8("x") }).subarray(0, 32)),
        context(),
      ),
    ).rejects.toThrow();
  });
  it("handles non-event END lines and text outside vCards", async () => {
    expect(() =>
      readIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:OTHER\nEND:VEVENT\nEND:VCALENDAR", 1),
    ).toThrow(/Mismatched/);
    await expect(readVcards("VERSION:4.0\nEND:VCARD", 1)).rejects.toThrow(/vCard/);
  });
  it("bypasses the file runner's old whole-upload cap for streaming archives", async () => {
    const file = zipFile(
      { "Takeout/Unknown/x": new Uint8Array(MAX_ENTRY_BYTES + 1) },
      ZIP_PIECE_BYTES,
      0,
    );
    const { report } = await fileImport(googleTakeoutFileAdapter, file);
    expect(report.unsupported).toEqual(["Unknown: entry-inflated-cap-exceeded"]);
  });
});

describe("Takeout conservative reconciliation", () => {
  it.each([
    "BEGIN:VCALENDAR",
    ICAL.replace("END:VCALENDAR", ""),
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a",
    "BEGIN:VCALENDAR\nEND:OTHER",
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nBEGIN:VTODO\nEND:VALARM\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nBEGIN:VTODO\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nBEGIN:VEVENT\nEND:VEVENT\nEND:VEVENT\nEND:VCALENDAR",
    "BEGIN:VCALENDAR\nBEGIN:VCALENDAR\nEND:VCALENDAR\nEND:VCALENDAR",
    "BEGIN:VEVENT\nEND:VEVENT",
    "END:VCALENDAR",
  ])("preserves calendar data after malformed components: %s", async (malformed) => {
    const name = "Takeout/Calendar/a.ics";
    const { pod } = await fileImport(googleTakeoutFileAdapter, zipFile({ [name]: ICAL }));
    const slug = `${ROOT}calendar/takeout/Calendar/a.ics.ttl`;
    const before = pod.get(slug);
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({
        [name]: "BEGIN:VCALENDAR\nEND:VCALENDAR",
        "Takeout/Calendar/bad.ics": malformed,
      }),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(pod.get(slug)).toBe(before);
  });

  it.each([
    "BEGIN:VCARD\nFN:Unfinished",
    `BEGIN:VCARD\nFN:Unfinished\n${VCARD}`,
    "BEGIN:VCARD\nBEGIN:OTHER\nEND:OTHER\nEND:VCARD",
    "BEGIN:VCARD\nEND:OTHER",
    "END:VCARD",
    "BEGIN:OTHER\nEND:OTHER",
  ])("preserves contact membership after malformed components: %s", async (malformed) => {
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/a.vcf": VCARD }),
    );
    const people = pod.get(`${ROOT}contacts/people.ttl`);
    const peopleUrls = pod.urls().filter((url) => url.includes("/Person/"));
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/empty.vcf": "", "Takeout/Contacts/bad.vcf": malformed }),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toEqual(peopleUrls);
    // Provenance changes on the index rewrite; membership stays the same.
    expect(pod.get(`${ROOT}contacts/people.ttl`)).toContain("Alex Example");
    expect(people).toContain("Alex Example");
  });

  it("reconciles a well-formed empty calendar with balanced skipped components", async () => {
    const name = "Takeout/Calendar/a.ics";
    const { pod } = await fileImport(googleTakeoutFileAdapter, zipFile({ [name]: ICAL }));
    await fileImport(
      googleTakeoutFileAdapter,
      zipFile({
        [name]: "BEGIN:VCALENDAR\nBEGIN:VTODO\nBEGIN:VALARM\nEND:VALARM\nEND:VTODO\nEND:VCALENDAR",
      }),
      { pod },
    );
    expect(pod.urls()).not.toContain(`${ROOT}calendar/takeout/Calendar/a.ics.ttl`);
  });

  it("does not prune contacts when a later archive has an incomplete contacts product", async () => {
    const initial = zipFile({
      "Takeout/Contacts/a.vcf": VCARD,
      "Takeout/Contacts/b.vcf": VCARD.replace("contact-1", "contact-2"),
    });
    const { pod } = await fileImport(googleTakeoutFileAdapter, initial);
    const report = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/a.vcf": VCARD, "Takeout/Contacts/b.vcf": "BEGIN:VCARD" }),
      { pod },
    );
    expect(report.report.skipped).toBe(1);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toHaveLength(2);
    const encrypted = zipSync({ "Takeout/Contacts/encrypted.vcf": strToU8(VCARD) });
    encrypted[6] |= 1;
    for (let i = 0; i + 46 <= encrypted.length; i++)
      if (new DataView(encrypted.buffer).getUint32(i, true) === 0x02014b50) encrypted[i + 8] |= 1;
    expect(
      await googleTakeoutFileAdapter.importFile(bytesFile(encrypted), context()),
    ).toMatchObject({ skipped: 1 });
  });
  it("counts mailbox row cap breaches and preserves ordinary read/archive mapping", async () => {
    const ctx = context(1);
    const first = RAW.replace(/^X-Gmail-Labels:.*\n/m, "").replace(/^X-GM-THRID:.*\n/m, "");
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Mail/a.mbox": `From a\n${first}\nFrom b\n${RAW}` }),
      ctx,
    );
    expect(report).toMatchObject({ skipped: 1 });
    const docs = [...ctx.docs.values()];
    const doc = docs.find((doc) => doc.slug.includes("/messages/"));
    expect([...doc!.dataset].some((q) => q.predicate.value.endsWith("dateRead"))).toBe(true);
    expect([...ctx.docs.keys()].some((slug) => slug.endsWith("system:archive.ttl"))).toBe(true);
  });
  it("handles a zero row limit before accepting any message", async () => {
    const ctx = context(0);
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({ "Takeout/Mail/a.mbox": `From a\n${RAW}` }),
      ctx,
    );
    expect(report).toMatchObject({ skipped: 1 });
  });
});

describe("mbox buffer boundary cases", () => {
  it("enforces the cap while resolving a partial prefix and rotates a full block at a line start", async () => {
    const skip = vi.fn();
    await mboxSink(async () => {}, skip, 1).push(strToU8("From a\nFro"), true);
    expect(skip).toHaveBeenCalledTimes(1);
    const oversized = mboxSink(async () => {}, skip, 1);
    await oversized.push(strToU8("abcd"), false);
    await oversized.push(strToU8("xyz"), true);
    expect(skip).toHaveBeenCalledTimes(2);
    const received: Uint8Array[] = [];
    const body = `${"a".repeat(8191)}\nb`;
    await mboxSink(async (raw) => {
      received.push(raw);
    }, skip).push(strToU8(body), true);
    expect(new TextDecoder().decode(received[0])).toBe(body);
  });
});

describe("Takeout later mail snapshots", () => {
  it("updates labels/read state at the same Message-ID when raw Takeout headers change", async () => {
    const first = zipFile({ "Takeout/Mail/a.mbox": `From sender\n${RAW}` });
    const { pod } = await fileImport(googleTakeoutFileAdapter, first);
    const updated = RAW.replace(/^X-Gmail-Labels:.*\n/m, "X-Gmail-Labels: Sent\n");
    await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Mail/a.mbox": `From sender\n${updated}` }),
      { pod },
    );
    const messages = pod.urls().filter((url) => url.includes("/messages/") && url.endsWith(".ttl"));
    expect(messages).toHaveLength(1);
    const mail = new MailMessage(`${messages[0]}#it`, pod.dataset(messages[0]), DataFactory);
    expect(mail.dateRead).toBeDefined();
    expect([...mail.folderIris]).toEqual([expect.stringContaining("system:sent.ttl")]);
  });
});

describe("Takeout archive entry count ceiling", () => {
  it("drains entries past 100,000 and bounds unsupported reporting after the ceiling", async () => {
    const entries: Record<string, Uint8Array> = {};
    const empty = new Uint8Array();
    for (let i = 0; i < 100_002; i++) entries[`Takeout/Unknown/${i}`] = empty;
    const ordinary = zipSync(entries, { level: 0 });
    const end = ordinary.length - 22;
    const zip64 = new Uint8Array(ordinary.length + 76);
    zip64.set(ordinary.subarray(0, end));
    const view = new DataView(zip64.buffer);
    view.setUint32(end, 0x06064b50, true);
    view.setBigUint64(end + 4, 44n, true);
    view.setBigUint64(end + 24, 100002n, true);
    view.setBigUint64(end + 32, 100002n, true);
    view.setBigUint64(
      end + 40,
      BigInt(new DataView(ordinary.buffer).getUint32(end + 12, true)),
      true,
    );
    view.setBigUint64(
      end + 48,
      BigInt(new DataView(ordinary.buffer).getUint32(end + 16, true)),
      true,
    );
    view.setUint32(end + 56, 0x07064b50, true);
    view.setBigUint64(end + 64, BigInt(end), true);
    view.setUint32(end + 72, 1, true);
    zip64.set(ordinary.subarray(end), end + 76);
    view.setUint16(end + 76 + 8, 0xffff, true);
    view.setUint16(end + 76 + 10, 0xffff, true);
    const file = bytesFile(zip64, ZIP_PIECE_BYTES);
    const ctx = context();
    await expect(googleTakeoutFileAdapter.importFile(file, ctx)).rejects.toThrow(
      /entry-count-cap-exceeded/,
    );
    expect(ctx.docs.size).toBe(0);
  }, 60000);
});

describe("Takeout fix-round regressions", () => {
  it("normalizes quoted recurrence parameters and standard contact types before shared mapping", async () => {
    const ctx = context();
    const report = await googleTakeoutFileAdapter.importFile(
      zipFile({
        "Takeout/Calendar/a.ics": ICAL.replaceAll("TZID=Europe/London", 'TZID="Europe/London"'),
        "Takeout/Contacts/a.vcf": VCARD.replace("TYPE=HOME", 'TYPE="PREF,HOME"').replace(
          "TYPE=WORK",
          "TYPE=VOICE;TYPE=WORK",
        ),
      }),
      ctx,
    );
    expect(report?.skipped).toBeUndefined();
    const person = [...ctx.docs.values()].find((doc) => doc.slug.startsWith("contacts/Person/"))!;
    const types = [...person.dataset]
      .filter((q) => q.predicate.value.endsWith("type"))
      .map((q) => q.object.value);
    expect(types).toContain("http://www.w3.org/2006/vcard/ns#Home");
    expect(types).toContain("http://www.w3.org/2006/vcard/ns#Work");
    expect(types).not.toContain("http://www.w3.org/2006/vcard/ns#Other");
    expect(
      [...ctx.docs.get("calendar/takeout/Calendar/a.ics.ttl")!.dataset].some((q) =>
        q.object.value.includes("2026-06-19"),
      ),
    ).toBe(true);
  });
  it("malformed nonempty vCards preserve previous address-book membership and count as skipped", async () => {
    const initial = zipFile({
      "Takeout/Contacts/a.vcf": VCARD,
      "Takeout/Contacts/b.vcf": VCARD.replace("contact-1", "contact-2"),
    });
    const { pod } = await fileImport(googleTakeoutFileAdapter, initial);
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/a.vcf": VCARD, "Takeout/Contacts/b.vcf": "not a vCard" }),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toHaveLength(2);
  });
  it("clears the last activity category and accepts a clearing-only import", async () => {
    const name = "Takeout/My Activity/YouTube/MyActivity.json";
    const { pod } = await fileImport(googleTakeoutFileAdapter, zipFile({ [name]: ACTIVITY }));
    const before = pod.urls().filter((url) => url.includes("youtube-activity"));
    expect(before).toHaveLength(1);
    const { report } = await fileImport(googleTakeoutFileAdapter, zipFile({ [name]: "[]" }), {
      pod,
    });
    expect(report.written).toHaveLength(0);
    expect(report.state.lastOutcome).toBe("success");
    expect(pod.urls()).not.toContain(before[0]);
  });
  it("clears one activity category when its last record is removed", async () => {
    const name = "Takeout/My Activity/All/MyActivity.json";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({
        [name]: JSON.stringify([{ header: "YouTube", title: "watch" }, { title: "search" }]),
      }),
    );
    await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: JSON.stringify([{ title: "search" }]) }),
      { pod },
    );
    expect(pod.urls().some((url) => url.includes("youtube-activity"))).toBe(false);
    expect(pod.urls().some((url) => url.includes("documents/google-activity"))).toBe(true);
  });
  const products = [
    {
      path: "Calendar/a.ics",
      initial: ICAL,
      empty: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      broken: "BEGIN:VEVENT",
      slug: "calendar/takeout/Calendar/a.ics.ttl",
    },
    {
      path: "My Activity/Search/MyActivity.json",
      initial: '[{"title":"previous"}]',
      empty: "[]",
      broken: "malformed",
      slug: "documents/google-activity",
    },
    {
      path: "Semantic Location History/2026/2026_JUNE.json",
      initial: allProducts()["Takeout/Semantic Location History/2026/2026_JUNE.json"],
      empty: '{"timelineObjects":[]}',
      broken: "malformed",
      slug: "location/takeout/",
    },
    {
      path: "Fit/Daily activity metrics/2026.csv",
      initial: "Date,Step count\n2026-06-12,10",
      empty: "Date,Step count",
      broken: "Date\ninvalid",
      slug: "health/takeout/",
    },
  ];
  it.each(
    products,
  )("preserves an empty $path snapshot if a later entry of its product fails", async ({
    path,
    initial,
    empty,
    broken,
    slug,
  }) => {
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [`Takeout/${path}`]: initial }),
    );
    const previous = pod.urls().find((url) => url.includes(slug))!;
    const old = [...pod.dataset(previous)].filter(
      (q) => !q.predicate.value.startsWith("http://www.w3.org/ns/prov#"),
    );
    const other = path.replace(/\.(ics|csv|json)$/, "-other.$1");
    // Activity dispatch requires MyActivity.json; use a second product subfolder.
    const sibling = path.startsWith("My Activity/")
      ? "My Activity/Other/MyActivity.json"
      : path.startsWith("Semantic Location History/")
        ? path.replace("JUNE", "JULY")
        : other;
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [`Takeout/${path}`]: empty, [`Takeout/${sibling}`]: broken }),
      { pod },
    );
    expect(report.skipped).toBe(1);
    expect(
      [...pod.dataset(previous)].filter(
        (q) => !q.predicate.value.startsWith("http://www.w3.org/ns/prov#"),
      ),
    ).toEqual(old);
  });
  it("merges valid activity records without pruning when another entry fails CRC", async () => {
    const name = "Takeout/My Activity/Search/MyActivity.json";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: '[{"title":"keep"},{"title":"previous"}]' }),
    );
    const bytes = zipSync({
      [name]: strToU8('[{"title":"keep"}]'),
      "Takeout/My Activity/Other/MyActivity.json": strToU8("[]"),
    });
    for (let i = 0, records = 0; i + 46 <= bytes.length; i++)
      if (new DataView(bytes.buffer).getUint32(i, true) === 0x02014b50 && ++records === 2) {
        bytes[i + 16] ^= 1;
        break;
      }
    const { report } = await fileImport(googleTakeoutFileAdapter, bytesFile(bytes), { pod });
    expect(report.skipped).toBe(1);
    const url = pod.urls().find((url) => url.includes("documents/google-activity"))!;
    expect([...pod.dataset(url)].some((q) => q.object.value === "previous")).toBe(true);
  });
  it("preserves activity data when malformed rows or a row ceiling omit records", async () => {
    const name = "Takeout/My Activity/Search/MyActivity.json";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: '[{"title":"previous"}]' }),
    );
    const { report } = await fileImport(googleTakeoutFileAdapter, zipFile({ [name]: "[null]" }), {
      pod,
    });
    expect(report.skipped).toBe(1);
    const url = pod.urls().find((url) => url.includes("documents/google-activity"))!;
    expect([...pod.dataset(url)].some((q) => q.object.value === "previous")).toBe(true);
  });
  it.each([
    [
      "malformed visits",
      [{ placeVisit: {} }, { placeVisit: null }, { placeVisit: { duration: {} } }],
    ],
    ["unrecognized rows", [null, {}, { activitySegment: null }]],
  ])("preserves location snapshots after %s", async (_, rows) => {
    const name = "Takeout/Semantic Location History/2026/2026_JUNE.json";
    const sibling = name.replace("JUNE", "JULY");
    const initial = allProducts()[name];
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: initial, [sibling]: initial }),
    );
    const previous = pod.urls().filter((url) => url.includes("location/takeout/"));
    const before = previous.map((url) => pod.get(url));
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({
        [name]: JSON.stringify({ timelineObjects: rows }),
        [sibling]: '{"timelineObjects":[]}',
      }),
      { pod },
    );
    expect(report.skipped).toBe(3);
    expect(previous.map((url) => pod.get(url))).toEqual(before);
  });
  it("reconciles a location snapshot containing only recognized activity segments", async () => {
    const name = "Takeout/Semantic Location History/2026/2026_JUNE.json";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: allProducts()[name] }),
    );
    const { report } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: '{"timelineObjects":[{"activitySegment":{}}]}' }),
      { pod },
    );
    expect(report.skipped).toBeUndefined();
    expect(pod.urls().some((url) => url.includes("location/takeout/"))).toBe(false);
  });
  it("does not prune contacts after archive entry-count rejection", async () => {
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ "Takeout/Contacts/a.vcf": VCARD }),
    );
    const before = pod.urls().filter((url) => url.includes("/Person/"));
    const bytes = zipSync({ "Takeout/Contacts/a.vcf": strToU8(VCARD) });
    new DataView(bytes.buffer).setUint16(bytes.length - 12, 2, true);
    await expect(fileImport(googleTakeoutFileAdapter, bytesFile(bytes), { pod })).rejects.toThrow();
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toEqual(before);
  });
});

describe("archive-wide completeness and mailbox preflight failures", () => {
  it("preserves staged snapshots when actual output from underdeclared entries exhausts the run", async () => {
    const calendar = "Takeout/Calendar/a.ics";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({
        [calendar]: ICAL,
        "Takeout/Contacts/a.vcf": VCARD,
      }),
    );
    const before = pod.get(`${ROOT}calendar/takeout/Calendar/a.ics.ttl`);
    const previousPeople = pod.urls().filter((url) => url.includes("/Person/"));
    const bytes = zipSync({
      [calendar]: strToU8("BEGIN:VCALENDAR\nEND:VCALENDAR"),
      "Takeout/Contacts/a.vcf": new Uint8Array(),
      "Takeout/Unknown/a": new Uint8Array(64),
      "Takeout/Unknown/b": new Uint8Array(64),
      "Takeout/Unknown/c": new Uint8Array(64),
    });
    const view = new DataView(bytes.buffer);
    let offset = view.getUint32(bytes.length - 6, true);
    for (let i = 0; i < 5; i++) {
      if (i >= 2) view.setUint32(offset + 24, 1, true);
      offset += 46 + view.getUint16(offset + 28, true);
    }
    await expect(
      fileImport(limitedArchive({ inflationBudget: new InflationBudget(100) }), bytesFile(bytes), {
        pod,
      }),
    ).rejects.toThrow(/total-inflated-cap-exceeded/);
    expect(pod.get(`${ROOT}calendar/takeout/Calendar/a.ics.ttl`)).toBe(before);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toEqual(previousPeople);
    expect(pod.get(`${ROOT}contacts/people.ttl`)).toContain("Alex Example");
  });
  it("aborts after a decoder error without reconciling earlier empty snapshots", async () => {
    const calendar = "Takeout/Calendar/a.ics";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [calendar]: ICAL, "Takeout/Contacts/a.vcf": VCARD }),
    );
    const calendarUrl = `${ROOT}calendar/takeout/Calendar/a.ics.ttl`;
    const before = pod.get(calendarUrl);
    const previousPeople = pod.urls().filter((url) => url.includes("/Person/"));
    const bytes = zipSync(
      {
        [calendar]: strToU8("BEGIN:VCALENDAR\nEND:VCALENDAR"),
        "Takeout/Contacts/a.vcf": new Uint8Array(),
        // Stored non-final output followed by a reserved DEFLATE block type.
        "Takeout/Unknown/broken": new Uint8Array([0, 1, 0, 254, 255, 97, 7]),
        "Takeout/Drive/after.txt": strToU8("must not import"),
      },
      { level: 0 },
    );
    const view = new DataView(bytes.buffer);
    let offset = view.getUint32(bytes.length - 6, true);
    for (let i = 0; i < 3; i++) {
      if (i === 2) {
        view.setUint16(offset + 10, 8, true);
        view.setUint16(view.getUint32(offset + 42, true) + 8, 8, true);
        view.setUint32(offset + 24, 1, true);
      }
      offset += 46 + view.getUint16(offset + 28, true);
    }
    await expect(fileImport(googleTakeoutFileAdapter, bytesFile(bytes), { pod })).rejects.toThrow(
      /ZIP decoder failed; archive import aborted/,
    );
    expect(pod.get(calendarUrl)).toBe(before);
    expect(pod.urls().filter((url) => url.includes("/Person/"))).toEqual(previousPeople);
    expect(pod.get(`${ROOT}contacts/people.ttl`)).toContain("Alex Example");
    expect(pod.urls().some((url) => url.includes("after.txt"))).toBe(false);
  });
  it("shares actual-byte accounting with mailbox sniffing and propagates its exhaustion", async () => {
    const raw = "From sender\nDelivered-To: a@example.test\n\nbody";
    const file = zipFile({ "Takeout/Mail/a.mbox": raw });
    const entries = await zipReader.zipDirectory(file);
    await expect(mailboxAccount(file, entries, new InflationBudget(8))).rejects.toThrow(
      /total-inflated-cap-exceeded/,
    );
    const inflationBudget = new InflationBudget(strToU8(raw).length + 1);
    expect(await mailboxAccount(file, entries, inflationBudget)).toBe("a@example.test");
    const ctx = context();
    expect(
      await importArchive(file, ctx, "a@example.test", entries, { inflationBudget }),
    ).toMatchObject({ skipped: 1, unsupported: ["Mail: total-inflated-cap-exceeded"] });
    expect(ctx.write).not.toHaveBeenCalled();
  });
  it("aborts mailbox sniffing on corrupt DEFLATE", async () => {
    const bytes = zipSync({
      "Takeout/Mail/a.mbox": strToU8("From sender\nDelivered-To: a@example.test\n\nbody"),
    });
    const view = new DataView(bytes.buffer);
    bytes[30 + view.getUint16(26, true)] = 7;
    const file = bytesFile(bytes);
    const directory = await zipReader.zipDirectory(file);
    await expect(mailboxAccount(file, directory)).rejects.toThrow(/ZIP decoder failed/);
    await expect(fileImport(googleTakeoutFileAdapter, file)).rejects.toThrow(/ZIP decoder failed/);
  });
  it("keeps mailbox fallback and byte accounting for entry validation failures", async () => {
    const raw = "From sender\nDelivered-To: a@example.test\n\nbody";
    const file = zipFile({ "Takeout/Mail/a.mbox": raw });
    const directory = await zipReader.zipDirectory(file);
    directory[0].size = 1;
    const inflationBudget = new InflationBudget(100);
    expect(await mailboxAccount(file, directory, inflationBudget)).toBe("google-takeout");
    expect(inflationBudget.remaining).toBe(100 - strToU8(raw).length);
  });
  it("a total-inflation ceiling preserves every product's previous snapshot", async () => {
    const name = "Takeout/My Activity/Search/MyActivity.json";
    const { pod } = await fileImport(
      googleTakeoutFileAdapter,
      zipFile({ [name]: '[{"title":"previous"}]' }),
    );
    const original = zipReader.readZip;
    const spy = vi
      .spyOn(zipReader, "readZip")
      .mockImplementation((file, options, entries) =>
        original(file, { ...options, inflationBudget: new InflationBudget(8) }, entries),
      );
    try {
      const { report } = await fileImport(
        googleTakeoutFileAdapter,
        zipFile({ [name]: "[]", "Takeout/Drive/a": "x".repeat(100) }),
        { pod },
      );
      expect(report.skipped).toBe(1);
      const url = pod.urls().find((url) => url.includes("documents/google-activity"))!;
      expect([...pod.dataset(url)].some((q) => q.object.value === "previous")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it("counts an invalid unsafe entry and preserves good contact members", async () => {
    const bytes = zipSync({
      "../a.vcf": strToU8(VCARD),
      "Takeout/Contacts/good.vcf": strToU8(VCARD),
    });
    // Only the unsafe entry's local flags disagree with the central record.
    bytes[6] ^= 1;
    expect(await googleTakeoutFileAdapter.importFile(bytesFile(bytes), context())).toMatchObject({
      skipped: 1,
    });
  });
  it("calendar mapping omissions make the product incomplete", async () => {
    const ctx = context();
    expect(
      await googleTakeoutFileAdapter.importFile(
        zipFile({
          "Takeout/Calendar/a.ics":
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:missing-start\nEND:VEVENT\nEND:VCALENDAR",
        }),
        ctx,
      ),
    ).toMatchObject({ skipped: 1 });
  });
  it("fails safely if a saved snapshot disappears before pruning", async () => {
    const ctx = context();
    ctx.read = vi.fn(async () => undefined);
    await expect(
      importArchive(
        zipFile({ "Takeout/My Activity/Search/MyActivity.json": '[{"title":"saved"}]' }),
        ctx,
      ),
    ).rejects.toThrow(/disappeared/);
  });
});

it("bounds mailbox header sniffing by bytes when UTF-8 characters span inflater pieces", async () => {
  const header = `From sender\nX-Note: ${"é".repeat(40_000)}\nDelivered-To: late@example.test\n\nbody`;
  const file = zipFile({ "Takeout/Mail/a.mbox": header });
  expect(await mailboxAccount(file, await zipReader.zipDirectory(file))).toBe("google-takeout");
});
