// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The demo pod's starting content: Alice's profile, an owner-only root ACL, an
 * empty private Type Index, and a small Drive tree that matches the Drive
 * acceptance fixtures (04-drive §9). RDF is serialised with `n3.Writer` from
 * DataFactory terms, the way a provisioning server writes a new account.
 */

import { NS } from "@jeswr/suite-vocab";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Writer } from "n3";
import { buildAgentSeed, demoApprovalVerificationMethod } from "../../apps/agent/lib/seed";
import { HILLS_PNG, REPORT_PDF, SUNSET_PNG } from "./binaries";
import type { DemoSeedFile } from "./pod";
import { seedContacts } from "./seed-contacts";
import { buildHomeSeed } from "./seed-home";
import { seedPermissions } from "./seed-permissions";
import { DEMO_INBOX, seedRequests } from "./seed-requests";

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const FOAF = "http://xmlns.com/foaf/0.1/";
const PIM = "http://www.w3.org/ns/pim/space#";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const LDP = "http://www.w3.org/ns/ldp#";

import { DEMO_ROOT, DEMO_WEBID } from "./constants";

export { DEMO_ROOT, DEMO_WEBID };
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
export interface DemoSeedOptions {
  /**
   * Seed Calendar events (default true). Calendar seeding is loaded lazily: it pulls in
   * `rrule`, whose CommonJS build has no named ESM exports, so Node-based e2e helpers that
   * only need other apps' data pass `false` to avoid importing it.
   */
  calendar?: boolean;
}

export async function buildDemoSeed(
  now: number,
  options: DemoSeedOptions = {},
): Promise<DemoSeedFile[]> {
  const me = namedNode(DEMO_WEBID);
  const root = namedNode(DEMO_ROOT);
  const profile = await turtle(
    [
      ...(await demoApprovalVerificationMethod()).quads,
      quad(me, RDF_TYPE, namedNode(`${FOAF}Person`)),
      quad(me, namedNode(`${FOAF}name`), literal(DEMO_NAME)),
      quad(me, namedNode(`${PIM}storage`), root),
      quad(me, namedNode(`${LDP}inbox`), namedNode(`${DEMO_ROOT}${DEMO_INBOX}`)),
      quad(
        me,
        namedNode(`${SOLID}privateTypeIndex`),
        namedNode(`${DEMO_ROOT}settings/privateTypeIndex.ttl`),
      ),
    ],
    { foaf: FOAF, pim: PIM, solid: SOLID, ldp: LDP },
  );
  const index = namedNode(`${DEMO_ROOT}settings/privateTypeIndex.ttl`);
  const typeIndex = await turtle(
    [
      quad(index, RDF_TYPE, namedNode(`${SOLID}TypeIndex`)),
      quad(index, RDF_TYPE, namedNode(`${SOLID}UnlistedDocument`)),
      quad(
        namedNode(`${index.value}#agent-workspace`),
        RDF_TYPE,
        namedNode(`${SOLID}TypeRegistration`),
      ),
      quad(
        namedNode(`${index.value}#agent-workspace`),
        namedNode(`${SOLID}forClass`),
        namedNode("https://jeswr.org/ns/agent#AgentWorkspace"),
      ),
      quad(
        namedNode(`${index.value}#agent-workspace`),
        namedNode(`${SOLID}instance`),
        namedNode(`${DEMO_ROOT}agent/`),
      ),
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
  const files: DemoSeedFile[] = [
    ...(await buildHomeSeed(now)),
    ...(await seedPermissions(DEMO_ROOT, DEMO_WEBID, now)),
    ...(await buildAgentSeed(now)),
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
  const seeded = async () => {
    if (options.calendar === false) return seedContacts(files, now);
    const { seedCalendar } = await import("./seed-calendar");
    return seedContacts(await seedCalendar(files, now), now);
  };
  return seedRequests(await seeded(), DEMO_ROOT, DEMO_WEBID, now);
}
