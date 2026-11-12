// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeFrom, RequiredAs } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT } from "../src/lib/demo-pod/seed";

/** The pre-sst-98ws seed: MaraCoach was granted access to the whole Health container. */
export async function legacyDemoHealthPod(now: number) {
  const files = await buildDemoSeed(now);
  const aclUrl = `${DEMO_ROOT}health/.acl`;
  const file = files.find((entry) => entry.path === "health/.acl");
  if (!file) throw new Error("Missing Health policy fixture");
  const dataset = new Store([
    ...(await parseRdf(String(file.body), "text/turtle", { baseIRI: aclUrl })),
  ]);
  const app = new Authorization(`${aclUrl}#maracoach`, dataset, DataFactory);
  app.type.add(`${NS.ACL}Authorization`);
  app.origin.add("https://maracoach.example");
  app.accessTo = `${DEMO_ROOT}health/`;
  app.canRead = true;
  app.canWrite = true;
  RequiredAs.object(
    app,
    `${NS.ACCESS_MANAGER}grantRef`,
    `${DEMO_ROOT}settings/access-records/maracoach.ttl`,
    NamedNodeFrom.string,
  );
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  return createDemoPod({
    root: DEMO_ROOT,
    seed: files
      .filter((entry) => entry.path !== "health/activity.ttl.acl")
      .map((entry) => (entry === file ? { ...entry, body } : entry)),
  });
}
