// AUTHORED-BY Claude Opus 5.5
/**
 * The demo pod's access-request fixtures (03-home-permissions §9 scenario 9): one pending ODRL
 * request in Alice's inbox from MaraCoach for her Activity data, the Type Index registration (of
 * the Activity document alone) that request resolves through, and the owner-only ACL a real pod gives its access-records folder.
 * RDF is built from DataFactory terms and serialised with `n3.Writer`.
 */

import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { TypeRegistration } from "../../apps/contacts/lib/model/discovery";
import type { DemoSeedFile } from "./pod";

const { namedNode, literal, blankNode, quad } = DataFactory;
const ACL = "http://www.w3.org/ns/auth/acl#";
const TYPE = namedNode(`${NS.RDF}type`);

export const DEMO_INBOX = "inbox/";
export const DEMO_REQUEST = `${DEMO_INBOX}maracoach-activity.ttl`;
export const DEMO_REQUESTER = "https://maracoach.example/profile/card#me";
export const DEMO_REQUESTER_NAME = "MaraCoach";
export const DEMO_REQUEST_PURPOSE = "build your training plan";
export const ACTIVITY_CLASS = `${NS.HEALTH}StepCountObservation`;
const INDEX = "settings/privateTypeIndex.ttl";
/** Seeded by seed-permissions: Alice's step counts. */
export const ACTIVITY_DOCUMENT = "health/activity.ttl";

function turtle(quads: Iterable<Quad>): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...quads]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/** MaraCoach asks to read Alice's Activity for one month, to build her training plan. */
function request(root: string, now: number): Quad[] {
  const id = namedNode(new URL(DEMO_REQUEST, root).href);
  const permission = blankNode("permission");
  const purpose = blankNode("purpose");
  const duration = blankNode("duration");
  const odrl = (name: string) => namedNode(NS.ODRL + name);
  const requester = namedNode(DEMO_REQUESTER);
  return [
    quad(id, TYPE, odrl("Offer")),
    quad(id, odrl("uid"), id),
    quad(id, namedNode(`${NS.ACCESS_MANAGER}dataClass`), namedNode(ACTIVITY_CLASS)),
    quad(
      id,
      namedNode(`${NS.DCT}created`),
      literal(new Date(now - 2 * 3_600_000).toISOString(), namedNode(`${NS.XSD}dateTime`)),
    ),
    quad(id, odrl("permission"), permission),
    quad(permission, odrl("assignee"), requester),
    quad(permission, odrl("action"), odrl("read")),
    quad(permission, odrl("target"), namedNode(ACTIVITY_CLASS)),
    quad(permission, odrl("constraint"), purpose),
    quad(permission, odrl("constraint"), duration),
    quad(purpose, odrl("leftOperand"), odrl("purpose")),
    quad(purpose, odrl("operator"), odrl("eq")),
    quad(purpose, odrl("rightOperand"), literal(DEMO_REQUEST_PURPOSE)),
    quad(duration, odrl("leftOperand"), odrl("elapsedTime")),
    quad(duration, odrl("operator"), odrl("eq")),
    quad(duration, odrl("rightOperand"), literal("P1M", namedNode(`${NS.XSD}duration`))),
    quad(requester, namedNode(`${NS.FOAF}name`), literal(DEMO_REQUESTER_NAME)),
  ];
}

/** Records hold recipients and purposes, so only the owner may read or write them. */
function recordsAcl(root: string, owner: string): Quad[] {
  const folder = namedNode(new URL("settings/access-records/", root).href);
  const rule = namedNode(`${folder.value}.acl#owner`);
  return [
    quad(rule, TYPE, namedNode(`${ACL}Authorization`)),
    quad(rule, namedNode(`${ACL}agent`), namedNode(owner)),
    quad(rule, namedNode(`${ACL}accessTo`), folder),
    quad(rule, namedNode(`${ACL}default`), folder),
    ...["Read", "Write", "Control"].map((mode) =>
      quad(rule, namedNode(`${ACL}mode`), namedNode(ACL + mode)),
    ),
  ];
}

/** Appends the request fixtures, keeping every other app's Type Index entries. */
export async function seedRequests(
  files: DemoSeedFile[],
  root: string,
  owner: string,
  now: number,
): Promise<DemoSeedFile[]> {
  const indexUrl = new URL(INDEX, root).href;
  const indexFile = files.find((file) => file.path === INDEX);
  const index = new Store(
    indexFile
      ? [...(await parseRdf(String(indexFile.body), "text/turtle", { baseIRI: indexUrl }))]
      : [],
  );
  const registration = new TypeRegistration(`${indexUrl}#activity`, index, DataFactory);
  registration.types.add(`${NS.SOLID}TypeRegistration`);
  registration.classes.add(ACTIVITY_CLASS);
  // The one document holding Activity, not the health/ container: approving Activity must never
  // reach the other Health data (vitals, conditions, medications) the Health app keeps there.
  registration.instance = new URL(ACTIVITY_DOCUMENT, root).href;
  return [
    ...files.filter((file) => file.path !== INDEX),
    { path: INDEX, body: await turtle(index), contentType: "text/turtle", modified: now },
    {
      path: DEMO_REQUEST,
      body: await turtle(request(root, now)),
      contentType: "text/turtle",
      modified: now - 2 * 3_600_000,
    },
    {
      path: "settings/access-records/.acl",
      body: await turtle(recordsAcl(root, owner)),
      contentType: "text/turtle",
      modified: now,
    },
  ];
}
