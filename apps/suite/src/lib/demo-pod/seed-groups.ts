// AUTHORED-BY Codex GPT-6.1-Sol

import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { serializeGroup } from "@jeswr/solid-task-model/contacts";
import { DEMO_ROOT, DEMO_WEBID } from "./constants";
import type { DemoSeedFile } from "./pod";

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
      body: await writeWac(policy, container, `${container}.acl`),
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
