// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { serializePlan } from "@jeswr/pod-legacy";
import { serialize } from "@jeswr/rdf-serialize";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoSeedFile } from "./pod";

export async function withDemoRecoveryProfile(profile: string): Promise<string> {
  const dataset = await parseRdf(profile, "text/turtle", { baseIRI: DEMO_WEBID });
  const agent = new TermWrapper(DEMO_WEBID, dataset, DataFactory);
  const issuers = SetFrom.subjectPredicate(
    agent,
    "http://www.w3.org/ns/solid/terms#oidcIssuer",
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  issuers.add("https://id.demo.pod/");
  issuers.add("https://backup-id.demo.pod/");
  return serialize([...dataset]);
}
export async function seedLegacy(now: number): Promise<DemoSeedFile[]> {
  const url = `${DEMO_ROOT}settings/legacy-plan.ttl`;
  const created = new Date(now);
  created.setUTCMonth(created.getUTCMonth() - 8);
  const lastActivity = new Date(now);
  lastActivity.setUTCMonth(lastActivity.getUTCMonth() - 5);
  return [
    {
      path: "settings/legacy-plan.ttl",
      modified: now,
      contentType: "text/turtle",
      body: await serializePlan(url, {
        owner: DEMO_WEBID,
        storage: DEMO_ROOT,
        contacts: [
          {
            webId: "https://alex.example/profile/card#me",
            displayName: "Alex (fictional)",
            mode: "read",
            scope: "containers",
            targets: [`${DEMO_ROOT}drive/Photos/`],
          },
        ],
        inactivityMonths: 6,
        warningDays: [30, 7],
        notifyMeBy: ["settings", "tray"],
        lastActivity,
        enabled: true,
        created,
        modified: lastActivity,
      }),
    },
    {
      path: "settings/legacy-plan.ttl.acl",
      modified: now,
      contentType: "text/turtle",
      body: await writeWac(ownerPolicy(DEMO_WEBID), url, `${url}.acl`),
    },
  ];
}
