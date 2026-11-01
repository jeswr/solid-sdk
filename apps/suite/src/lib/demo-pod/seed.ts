// AUTHORED-BY Claude Opus 5.5
/**
 * The demo pod's starting content: Alice's profile, an owner-only root ACL, an
 * empty private Type Index, and a small Drive tree that matches the Drive
 * acceptance fixtures (04-drive §9). RDF is serialised with `n3.Writer` from
 * DataFactory terms, the way a provisioning server writes a new account.
 */

import { NS } from "@jeswr/suite-vocab";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Writer } from "n3";
import { HILLS_PNG, REPORT_PDF, SUNSET_PNG } from "./binaries";
import type { DemoSeedFile } from "./pod";

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const FOAF = "http://xmlns.com/foaf/0.1/";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const VCARD = "http://www.w3.org/2006/vcard/ns#";

export const DEMO_ROOT = "https://alice.demo.pod/";
export const DEMO_WEBID = `${DEMO_ROOT}profile/card#me`;
export const DEMO_NAME = "Alice Wilder";
export const DRIVE_ROOT_CLASS = `${NS.POD_DRIVE}DriveRoot`;

function turtle(quads: Quad[], prefixes: Record<string, string>): Promise<string> {
  const writer = new Writer({ format: "text/turtle", prefixes });
  writer.addQuads(quads);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

const DAY = 86_400_000;

/** Build the seed relative to `now` so "Modified" columns look recent. */
export async function buildDemoSeed(now: number): Promise<DemoSeedFile[]> {
  const me = namedNode(DEMO_WEBID);
  const root = namedNode(DEMO_ROOT);
  const profile = await turtle(
    [
      quad(me, RDF_TYPE, namedNode(`${FOAF}Person`)),
      quad(me, namedNode(`${FOAF}name`), literal(DEMO_NAME)),
      quad(me, namedNode(`${PIM}storage`), root),
      quad(
        me,
        namedNode(`${SOLID}privateTypeIndex`),
        namedNode(`${DEMO_ROOT}settings/privateTypeIndex.ttl`),
      ),
    ],
    { foaf: FOAF, pim: PIM, solid: SOLID },
  );
  const index = namedNode(`${DEMO_ROOT}settings/privateTypeIndex.ttl`);
  const typeIndex = await turtle(
    [
      quad(index, RDF_TYPE, namedNode(`${SOLID}TypeIndex`)),
      quad(index, RDF_TYPE, namedNode(`${SOLID}UnlistedDocument`)),
    ],
    { solid: SOLID },
  );
  const owner = namedNode(`${DEMO_ROOT}.acl#owner`);
  const acl = await turtle(
    [
      quad(owner, RDF_TYPE, namedNode(`${ACL}Authorization`)),
      quad(owner, namedNode(`${ACL}agent`), me),
      quad(owner, namedNode(`${ACL}accessTo`), root),
      quad(owner, namedNode(`${ACL}default`), root),
      quad(owner, namedNode(`${ACL}mode`), namedNode(`${ACL}Read`)),
      quad(owner, namedNode(`${ACL}mode`), namedNode(`${ACL}Write`)),
      quad(owner, namedNode(`${ACL}mode`), namedNode(`${ACL}Control`)),
    ],
    { acl: ACL },
  );
  const card = namedNode(`${DEMO_ROOT}drive/data.ttl#it`);
  const contact = await turtle(
    [
      quad(card, RDF_TYPE, namedNode(`${VCARD}Individual`)),
      quad(card, namedNode(`${VCARD}fn`), literal("Bram Kerst")),
      quad(card, namedNode(`${VCARD}hasEmail`), namedNode("mailto:bram@example.org")),
      quad(card, namedNode(`${VCARD}organization-name`), literal("Open Data Works")),
    ],
    { vcard: VCARD },
  );
  const notes = [
    "# Notes",
    "",
    "- Book train to Ghent",
    "- Ask Bram about the sync service",
    "- Draft the launch plan in Docs",
    "",
  ].join("\n");
  return [
    { path: "profile/card", body: profile, contentType: "text/turtle", modified: now - 40 * DAY },
    {
      path: "settings/privateTypeIndex.ttl",
      body: typeIndex,
      contentType: "text/turtle",
      modified: now - 40 * DAY,
    },
    { path: ".acl", body: acl, contentType: "text/turtle", modified: now - 40 * DAY },
    {
      path: "drive/Work/Report.pdf",
      body: REPORT_PDF,
      contentType: "application/pdf",
      modified: now - 2 * DAY,
    },
    {
      path: "drive/Work/Budget%202026.csv",
      body: "Category,Planned,Actual\nTravel,1200,980\nEquipment,800,1020\nTraining,600,450\n",
      contentType: "text/csv",
      modified: now - 9 * DAY,
    },
    {
      path: "drive/Photos/sunset.png",
      body: SUNSET_PNG,
      contentType: "image/png",
      modified: now - 3 * 3_600_000,
    },
    {
      path: "drive/Photos/hills.png",
      body: HILLS_PNG,
      contentType: "image/png",
      modified: now - 20 * DAY,
    },
    { path: "drive/notes.md", body: notes, contentType: "text/markdown", modified: now - DAY },
    { path: "drive/data.ttl", body: contact, contentType: "text/turtle", modified: now - 12 * DAY },
    { path: "drive/Archive/", body: "", contentType: "text/turtle", modified: now - 30 * DAY },
  ];
}
