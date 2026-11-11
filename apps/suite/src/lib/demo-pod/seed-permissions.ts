// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { DemoSeedFile } from "./pod";

const ACL = "http://www.w3.org/ns/auth/acl#";
const DPV = "https://w3id.org/dpv#";
const BOB = "https://bob.demo.pod/profile/card#me";
const APP = "https://maracoach.example";

class SeedNode extends TermWrapper {
  iri(predicate: string, value: string) {
    SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string).add(value);
    return this;
  }
  text(predicate: string, value: string) {
    RequiredAs.object(this, predicate, value, LiteralFrom.string);
    return this;
  }
}
async function document(
  path: string,
  root: string,
  now: number,
  build: (node: (id: string) => SeedNode) => void,
): Promise<DemoSeedFile> {
  const dataset = new Store();
  build((id) => new SeedNode(DataFactory.namedNode(id), dataset, DataFactory));
  const writer = new Writer({ format: "text/turtle", prefixes: { acl: ACL, dpv: DPV } });
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  return {
    path: new URL(path, root).href.slice(root.length),
    body,
    contentType: "text/turtle",
    modified: now,
  };
}

/** Each own policy retains Alice's direct access and, for folders, her default control. */
export async function seedPermissions(
  root: string,
  owner: string,
  now: number,
): Promise<DemoSeedFile[]> {
  const auth = (node: (id: string) => SeedNode, path: string, folder: boolean) => {
    const resource = new URL(path, root).href;
    const grant = node(`${resource}.acl#owner`)
      .iri(`${NS.RDF}type`, `${ACL}Authorization`)
      .iri(`${ACL}agent`, owner)
      .iri(`${ACL}accessTo`, resource);
    for (const mode of ["Read", "Write", "Control"]) grant.iri(`${ACL}mode`, ACL + mode);
    if (folder) grant.iri(`${ACL}default`, resource);
    return resource;
  };
  return Promise.all([
    document("drive/Work/.acl", root, now, (node) => {
      const resource = auth(node, "drive/Work/", true);
      node(`${resource}.acl#bob`)
        .iri(`${NS.RDF}type`, `${ACL}Authorization`)
        .iri(`${ACL}agent`, BOB)
        .iri(`${ACL}default`, resource)
        .iri(`${ACL}mode`, `${ACL}Read`)
        .text(`${NS.DCT}created`, new Date(now - 14 * 86400000).toISOString());
    }),
    document("drive/Photos/sunset.png.acl", root, now, (node) => {
      const resource = auth(node, "drive/Photos/sunset.png", false);
      node(`${resource}.acl#public`)
        .iri(`${NS.RDF}type`, `${ACL}Authorization`)
        .iri(`${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent")
        .iri(`${ACL}accessTo`, resource)
        .iri(`${ACL}mode`, `${ACL}Read`);
    }),
    document("health/.acl", root, now, (node) => {
      // Health verifies both this container and its default policy before saving.
      auth(node, "health/", true);
    }),
    document("health/activity.ttl.acl", root, now, (node) => {
      // The permissions demo shares only the fictional Activity document. Its
      // policy must never apply to Health's measurements or clinical records.
      const resource = auth(node, "health/activity.ttl", false);
      node(`${resource}.acl#maracoach`)
        .iri(`${NS.RDF}type`, `${ACL}Authorization`)
        .iri(`${ACL}origin`, APP)
        .iri(`${ACL}accessTo`, resource)
        .iri(`${ACL}mode`, `${ACL}Read`)
        .iri(`${ACL}mode`, `${ACL}Write`)
        .iri(`${NS.ACCESS_MANAGER}grantRef`, `${root}settings/access-records/maracoach.ttl`);
    }),
    document("health/activity.ttl", root, now, (node) => {
      node(`${root}health/activity.ttl#it`)
        .iri(`${NS.RDF}type`, `${NS.HEALTH}StepCountObservation`)
        .text(`${NS.SCHEMA}name`, "Morning walk");
    }),
    document("settings/access-records/maracoach.ttl", root, now, (node) => {
      node(`${root}settings/access-records/maracoach.ttl`)
        .iri(`${NS.RDF}type`, `${DPV}ConsentRecord`)
        .iri(`${DPV}hasRecipient`, APP)
        .iri(`${DPV}hasPurpose`, `${DPV}ServicePersonalisation`)
        .text(`${NS.DCT}created`, new Date(now - 7 * 86400000).toISOString())
        .text(`${NS.DCT}modified`, new Date(now - 86400000).toISOString());
    }),
  ]);
}
