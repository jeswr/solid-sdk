// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Generate the worked example fedapp: Client-ID block via @rdfjs/wrapper TYPED
// accessors (never hand-built triples) and serialise with n3.Writer. The output
// (dist/example-clientid.ttl) is the reference an app embeds in its
// clientid.jsonld — and proves the typed-builder path round-trips.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Store, DataFactory, Writer } from "n3";
import {
  TermWrapper,
  SetFrom,
  NamedNodeAs,
  NamedNodeFrom,
} from "@rdfjs/wrapper";

const FEDAPP = "https://w3id.org/jeswr/fed#";
const ACL = "http://www.w3.org/ns/auth/acl#";
// The shared task CLASS is the re-used wf:Task (NOT a minted tm:Task) — see
// task.ttl + the @contexts, which map "Task" → wf:Task. Apps consume/produce
// the same IRI a consumer expects.
const WF = "http://www.w3.org/2005/01/wf/flow#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Typed view of an app's Client-ID subject — object properties only. */
class FedAppDoc extends TermWrapper {
  get types() {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get sector() {
    return SetFrom.subjectPredicate(this, `${FEDAPP}sector`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get access() {
    return SetFrom.subjectPredicate(this, `${FEDAPP}access`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get consumes() {
    return SetFrom.subjectPredicate(this, `${FEDAPP}consumes`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get produces() {
    return SetFrom.subjectPredicate(this, `${FEDAPP}produces`, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

const store = new Store();
const doc = new FedAppDoc("https://app.example/clientid.jsonld", store, DataFactory);

doc.types.add(`${FEDAPP}App`);
doc.sector.add("https://w3id.org/jeswr/sectors/scheduling#sector");
doc.access.add(`${ACL}Read`);
doc.access.add(`${ACL}Write`);
doc.access.add(`${ACL}Append`);
doc.produces.add(`${WF}Task`);
doc.consumes.add(`${WF}Task`);

const writer = new Writer({
  prefixes: { fedapp: FEDAPP, acl: ACL, wf: WF, sectors: "https://w3id.org/jeswr/sectors/" },
});
writer.addQuads(store.getQuads(null, null, null, null));

const out = await new Promise((resolve, reject) =>
  writer.end((err, result) => (err ? reject(err) : resolve(result))),
);

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, "example-clientid.ttl"), out);
console.log("dist/example-clientid.ttl (built via @rdfjs/wrapper typed accessors + n3.Writer):\n");
console.log(out);
