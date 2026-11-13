// AUTHORED-BY Codex GPT-6.1-Sol
import { shareNotification } from "@jeswr/pod-access/notify";
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
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoSeedFile } from "./pod";

const AS = "https://www.w3.org/ns/activitystreams#";
const taskUrl = `${DEMO_ROOT}tasks/projects/weekend-plans.ttl`;
const sheetUrl = `${DEMO_ROOT}sheets/trip-budget/`;

/** Fictional senders announce useful demo resources; no grant or access-control claims. */
export async function seedShared(now: number): Promise<DemoSeedFile[]> {
  const files: DemoSeedFile[] = [];
  for (const [id, object, name, sender, role, age] of [
    ["doc", `${DEMO_ROOT}docs/launch.ttl`, "Launch plan", "bob", "Editor", 1],
    ["sheet", sheetUrl, "Trip budget", "maya", "Viewer", 2],
    ["tasks", taskUrl, "Weekend plans", "alex", "Editor", 3],
    ["calendar", `${DEMO_ROOT}calendar/work.ttl`, "Team calendar", "sam", "Viewer", 4],
  ] as const) {
    const path = `inbox/shared-${id}.ttl`;
    const draft = shareNotification(object, role);
    const dataset = new Store();
    const activity = new TermWrapper(`${DEMO_ROOT}${path}#it`, dataset, DataFactory);
    SetFrom.subjectPredicate(
      activity,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add(`${AS}${draft.type}`);
    for (const [predicate, value] of [
      ["object", object],
      ["actor", `https://${sender}.demo.pod/profile/card#me`],
    ]) {
      OptionalAs.object(activity, AS + predicate, value, NamedNodeFrom.string);
    }
    OptionalAs.object(activity, `${AS}summary`, draft.summary, LiteralFrom.string);
    OptionalAs.object(activity, `${AS}content`, name, LiteralFrom.string);
    OptionalAs.object(
      activity,
      `${AS}published`,
      new Date(now - age * 3_600_000),
      LiteralFrom.dateTime,
    );
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads([...dataset]);
    const body = await new Promise<string>((resolve, reject) =>
      writer.end((error, value) => (error ? reject(error) : resolve(value))),
    );
    files.push({ path, body, contentType: "text/turtle", modified: now });
  }
  const tracker = createTracker(
    taskUrl,
    "Weekend plans",
    taskUrl.replace(/\.ttl$/, "/"),
    [DEMO_WEBID],
    new Date(now),
  );
  files.push({
    path: taskUrl.slice(DEMO_ROOT.length),
    body: await serialize(tracker.dataset),
    contentType: "text/turtle",
    modified: now,
  });
  files.push({
    path: "tasks/projects/weekend-plans/",
    body: "",
    contentType: "text/turtle",
    modified: now,
  });
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
  files.push({
    path: layout.index.slice(DEMO_ROOT.length),
    body: await serializeWorkbook(sheetUrl, {
      title: "Trip budget",
      creator: DEMO_WEBID,
      created: new Date(now),
      modified: new Date(now),
      sheets: [{ number: 1, name: "Budget" }],
    }),
    contentType: "text/turtle",
    modified: now,
  });
  files.push({
    path: layout.snapshot.slice(DEMO_ROOT.length),
    body: serializeSnapshot(snapshot),
    contentType: "application/json",
    modified: now,
  });
  return files;
}
