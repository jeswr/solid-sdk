// AUTHORED-BY Claude Sonnet 5.5
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { serializeWorkbook, workbookLayout } from "@/apps/sheets/lib/model/rdf";
import { serializeSnapshot } from "@/apps/sheets/lib/model/snapshot";
import { serialize } from "@/apps/tasks/lib/model/rdf";
import { createTracker } from "@/apps/tasks/lib/model/tracker";
import { FRIENDS_ROOT } from "./constants";
import type { DemoSeedFile } from "./pod";

const SCHEMA_NAME = "https://schema.org/name";

async function turtle(subject: string, type: string, name: string): Promise<string> {
  const dataset = new Store();
  const node = new TermWrapper(subject, dataset, DataFactory);
  SetFrom.subjectPredicate(node, `${NS.RDF}type`, NamedNodeAs.string, NamedNodeFrom.string).add(
    type,
  );
  OptionalAs.object(node, SCHEMA_NAME, name, LiteralFrom.string);
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
}

/**
 * The fictional friends' pod ({@link FRIENDS_ROOT}): the resources that the demo user's inbox
 * announces as shared with them. It is outside the demo user's own storage and served
 * read-only by the browser demo, so previews of these shares open. Fictional people only.
 */
export async function seedFriendsPod(now: number): Promise<DemoSeedFile[]> {
  const root = FRIENDS_ROOT;
  const friend = `${root}profile/card#me`;
  const taskUrl = `${root}tasks/projects/weekend-plans.ttl`;
  const sheetUrl = `${root}sheets/trip-budget/`;
  const file = (path: string, body: string, contentType = "text/turtle"): DemoSeedFile => ({
    path,
    body,
    contentType,
    modified: now,
  });
  const files: DemoSeedFile[] = [
    file(
      "docs/launch.ttl",
      await turtle(`${root}docs/launch.ttl#it`, `${NS.POD_DOCS}Document`, "Launch plan"),
    ),
  ];
  const tracker = createTracker(
    taskUrl,
    "Weekend plans",
    taskUrl.replace(/\.ttl$/, "/"),
    [friend],
    new Date(now),
  );
  files.push(
    file("tasks/projects/weekend-plans.ttl", await serialize(tracker.dataset)),
    file("tasks/projects/weekend-plans/", ""),
  );
  const layout = workbookLayout(sheetUrl);
  // A native workbook snapshot fixture; no spreadsheet engine needs to boot while seeding.
  const snapshot = {
    id: "demo-trip-budget",
    name: "Trip budget",
    appVersion: "1.2.0",
    locale: "enUS",
    styles: {},
    sheetOrder: ["sheet1"],
    sheets: {
      sheet1: {
        id: "sheet1",
        name: "Budget",
        rowCount: 1000,
        columnCount: 26,
        cellData: {
          "0": { "0": { v: "Item", t: 1 }, "1": { v: "Cost", t: 1 } },
          "1": { "0": { v: "Train", t: 1 }, "1": { v: 45, t: 2 } },
          "2": { "0": { v: "Lunch", t: 1 }, "1": { v: 20, t: 2 } },
        },
      },
    },
  };
  files.push(
    file(
      layout.index.slice(root.length),
      await serializeWorkbook(sheetUrl, {
        title: "Trip budget",
        creator: friend,
        created: new Date(now),
        modified: new Date(now),
        sheets: [{ number: 1, name: "Budget" }],
      }),
    ),
    file(layout.snapshot.slice(root.length), serializeSnapshot(snapshot), "application/json"),
  );
  // Loaded on demand: the calendar model is only needed when this pod is first served.
  const { buildCalendar, serializeDataset } = await import("../../apps/calendar/lib/model");
  files.push(
    file(
      "calendar/work.ttl",
      await serializeDataset(buildCalendar(`${root}calendar/work.ttl`, { title: "Team calendar" })),
    ),
  );
  return files;
}
