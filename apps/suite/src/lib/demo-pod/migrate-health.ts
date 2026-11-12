// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { NamedNodeFrom, RequiredAs } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoPod } from "./pod";
import { seedPermissions } from "./seed-permissions";

/** Repair only the exact old seed policy; keep user-created policies fail-closed. */
export async function migrateDemoHealthPrivacy(pod: DemoPod): Promise<boolean> {
  if (pod.root !== DEMO_ROOT) return false;
  const container = `${DEMO_ROOT}health/`;
  const aclUrl = `${container}.acl`;
  const activityAcl = `${container}activity.ttl.acl`;
  let previous: Awaited<ReturnType<typeof fetchRdf>>;
  try {
    previous = await fetchRdf(aclUrl, { fetch: pod.fetch });
  } catch {
    // An unreadable or absent policy is not the known seed. Leave it unchanged;
    // Health still performs its own privacy check, while other apps can open.
    return false;
  }
  if (previous.dataset.size !== 13 || !previous.etag) return false;
  // Construct the old fixture with typed accessors and compare the entire graph.
  // Any edit (including another grant) makes it ineligible for automatic repair.
  const files = await seedPermissions(DEMO_ROOT, DEMO_WEBID, 0);
  const privateFile = files.find((file) => file.path === "health/.acl");
  const activityFile = files.find((file) => file.path === "health/activity.ttl.acl");
  if (!privateFile || !activityFile) throw new Error("Missing demo Health policies");
  const privatePolicy = await parseRdf(String(privateFile.body), "text/turtle", {
    baseIRI: aclUrl,
  });
  const legacy = new Store([...privatePolicy]);
  const app = new Authorization(`${aclUrl}#maracoach`, legacy, DataFactory);
  app.type.add(`${NS.ACL}Authorization`);
  app.origin.add("https://maracoach.example");
  app.accessTo = container;
  app.canRead = true;
  app.canWrite = true;
  RequiredAs.object(
    app,
    `${NS.ACCESS_MANAGER}grantRef`,
    `${DEMO_ROOT}settings/access-records/maracoach.ttl`,
    NamedNodeFrom.string,
  );
  if (
    previous.dataset.size !== legacy.size ||
    ![...legacy].every((quad) => previous.dataset.has(quad))
  )
    return false;

  const activityPolicy = await parseRdf(String(activityFile.body), "text/turtle", {
    baseIRI: activityAcl,
  });
  let existing: Awaited<ReturnType<typeof fetchRdf>> | undefined;
  try {
    existing = await fetchRdf(activityAcl, { fetch: pod.fetch });
  } catch (error) {
    if (!(error instanceof RdfFetchError && error.status === 404)) return false;
  }
  if (existing && !existing.etag) return false;
  const merged = new Store(existing ? [...existing.dataset] : [...activityPolicy]);
  if (existing) {
    // Keep any previously approved document grants. A collision with an edited
    // fixture rule must be resolved by the user, just like an edited folder ACL.
    const subject = DataFactory.namedNode(`${activityAcl}#maracoach`);
    const expected = activityPolicy.match(subject);
    const actual = existing.dataset.match(subject);
    if (
      actual.size &&
      (actual.size !== expected.size || ![...actual].every((quad) => expected.has(quad)))
    )
      return false;
    merged.addQuads([...expected]);
  }
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...merged]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  const activity = await pod.fetch(activityAcl, {
    method: "PUT",
    headers: {
      "content-type": "text/turtle",
      ...(existing ? { "if-match": existing.etag as string } : { "if-none-match": "*" }),
    },
    body,
  });
  if (!activity.ok) throw new Error("Couldn't migrate demo Activity access");
  const privacy = await pod.fetch(aclUrl, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-match": previous.etag },
    body: String(privateFile.body),
  });
  if (!privacy.ok) throw new Error("Couldn't migrate demo Health access");
  return true;
}
