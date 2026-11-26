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
import { DEMO_ROOT, FRIENDS_ROOT } from "./constants";
import type { DemoSeedFile } from "./pod";

const AS = "https://www.w3.org/ns/activitystreams#";

/**
 * Fictional friends announce resources that live in their own pod ({@link FRIENDS_ROOT}), so
 * they are genuinely outside the demo user's storage and count as shared with them. Only the
 * inbox notifications are seeded here; no grant or access-control claims are made.
 */
export async function seedShared(now: number): Promise<DemoSeedFile[]> {
  const files: DemoSeedFile[] = [];
  for (const [id, object, name, sender, role, age] of [
    ["doc", `${FRIENDS_ROOT}docs/launch.ttl`, "Launch plan", "bob", "Editor", 1],
    ["sheet", `${FRIENDS_ROOT}sheets/trip-budget/`, "Trip budget", "maya", "Viewer", 2],
    [
      "tasks",
      `${FRIENDS_ROOT}tasks/projects/weekend-plans.ttl`,
      "Weekend plans",
      "alex",
      "Editor",
      3,
    ],
    ["calendar", `${FRIENDS_ROOT}calendar/work.ttl`, "Team calendar", "sam", "Viewer", 4],
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
  return files;
}
