// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { Store } from "n3";
import { ACL } from "../../src/engine/rdf.js";
import type { Mode } from "../../src/engine/types.js";
import type { FakePod, Identity } from "./fake-pod.js";

const requireCss = createRequire(import.meta.url);
const { allowAccessModes } = createRequire(
  requireCss.resolve("@solid/community-server/package.json"),
)("@solid/access-control-policy");
const { getAccessControlledResources } = requireCss(
  "@solid/community-server/dist/authorization/AcpUtil.js",
);
const { WebAclReader } = requireCss("@solid/community-server/dist/authorization/WebAclReader.js");
const { AgentAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentAccessChecker.js",
);
const { AgentClassAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentClassAccessChecker.js",
);
const { AgentGroupAccessChecker } = requireCss(
  "@solid/community-server/dist/authorization/access/AgentGroupAccessChecker.js",
);
const { BooleanHandler } = requireCss(
  "@solid/community-server/dist/util/handlers/BooleanHandler.js",
);

/** Actual installed CSS readers/evaluator, independent of the neutral model and serializers. */
export async function cssAccess(pod: FakePod, url: string, identity: Identity): Promise<Set<Mode>> {
  if (pod.implementation !== "css") throw new TypeError("CSS oracle requires a CSS pod");
  const credentials = {
    agent: identity.agent ? { webId: identity.agent } : undefined,
    client: identity.client ? { clientId: identity.client } : undefined,
    issuer: identity.issuer ? { url: identity.issuer } : undefined,
  };
  if (pod.system === "wac") {
    const groupChecker = new AgentGroupAccessChecker();
    groupChecker.fetchQuads = async (groupUrl: string) => {
      const groupPod = pod.groupSource?.data.has(groupUrl) ? pod.groupSource : pod;
      const response = await groupPod.publicFetch(groupUrl);
      if (!response.ok) return new Store();
      const { parseRdf } = await import("@jeswr/fetch-rdf");
      return parseRdf(await response.text(), "text/turtle", { baseIRI: groupUrl });
    };
    const reader = new WebAclReader(
      {},
      {},
      {},
      {},
      new BooleanHandler([new AgentAccessChecker(), new AgentClassAccessChecker(), groupChecker]),
    );
    for (const ancestor of pod.ancestors(url)) {
      const dataset = await pod.dataset(ancestor);
      if (!dataset) continue;
      const selected = await reader.filterStore(dataset, ancestor, ancestor === url);
      const result = await reader.determinePermissions(selected, credentials);
      return new Set((Object.keys(result) as Mode[]).filter((mode) => result[mode]));
    }
    return new Set();
  }
  const policies = [];
  for (const ancestor of pod.ancestors(url)) {
    const dataset = await pod.dataset(ancestor);
    if (!dataset) continue;
    for (const entry of getAccessControlledResources(dataset))
      for (const control of entry.accessControlResource[
        entry.iri === url ? "accessControl" : "memberAccessControl"
      ])
        policies.push(...control.policy);
  }
  // AcpReader.createContext supplies exactly these attributes, never owner/creator/VC.
  const modes: Set<string> = allowAccessModes(policies, {
    target: url,
    agent: identity.agent,
    client: identity.client,
    issuer: identity.issuer,
  });
  const result = new Set<Mode>();
  for (const mode of ["read", "write", "append", "control"] as const)
    if (modes.has(ACL + mode[0]?.toUpperCase() + mode.slice(1))) result.add(mode);
  if (result.has("write")) result.add("append");
  return result;
}
