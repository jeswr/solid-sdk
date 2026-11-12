// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { parseRdf } from "@jeswr/fetch-rdf";
import { type EffectivePolicy, ownerPolicy, writeWac } from "@jeswr/pod-access";
import { sealDataset } from "@jeswr/pod-access/roles";
import { serializeGroup } from "@jeswr/solid-task-model/contacts";
import { Writer } from "n3";
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoSeedFile } from "./pod";

/**
 * A folder ACL carrying the owner's seal, as group sharing leaves a folder it verified empty
 * before securing it; readers trust nothing in an unsealed folder.
 */
async function sealedAcl(folder: string, policy: EffectivePolicy): Promise<string> {
  const acl = `${folder}.acl`;
  const dataset = await parseRdf(await writeWac(policy, folder, acl), "text/turtle", {
    baseIRI: acl,
  });
  sealDataset(dataset, acl, DEMO_WEBID);
  return new Writer().quadsToString([...dataset]);
}

export async function seedGroups(files: DemoSeedFile[], now: number): Promise<DemoSeedFile[]> {
  const container = new URL("groups/", DEMO_ROOT).href;
  const policy = ownerPolicy(DEMO_WEBID, true);
  policy.grants.push({
    who: [[{ kind: "public" }]],
    except: [],
    modes: new Set(["read"]),
    appliesTo: "both",
    source: { url: `${container}.acl`, node: `${container}.acl#public` },
  });
  const groups = [
    {
      slug: "family",
      name: "Family",
      members: [
        DEMO_WEBID,
        "https://bob.demo.pod/profile/card#me",
        "https://carol.demo.pod/profile/card#me",
      ],
    },
    {
      slug: "team",
      name: "Garden team",
      members: [DEMO_WEBID, "https://dana.demo.pod/profile/card#me"],
    },
  ];
  const additions: DemoSeedFile[] = [
    {
      path: "groups/.acl",
      body: await sealedAcl(container, policy),
      contentType: "text/turtle",
      modified: now,
    },
    {
      path: "settings/group-sharing/.acl",
      body: await sealedAcl(
        new URL("settings/group-sharing/", DEMO_ROOT).href,
        ownerPolicy(DEMO_WEBID, true),
      ),
      contentType: "text/turtle",
      modified: now,
    },
    {
      path: "settings/group-sharing/state.json",
      body: JSON.stringify({ family: `${container}family.ttl#this`, notices: [], spaces: {} }),
      contentType: "application/json",
      modified: now,
    },
  ];
  for (const group of groups)
    additions.push({
      path: `groups/${group.slug}.ttl`,
      body: await serializeGroup(`${container}${group.slug}.ttl`, group),
      contentType: "text/turtle",
      modified: now,
    });
  return [...files, ...additions];
}
