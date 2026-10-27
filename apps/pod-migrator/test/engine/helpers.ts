// AUTHORED-BY Codex GPT-6
import { ownerPolicy, unionPolicies } from "../../src/engine/policy.js";
import { writeAcp } from "../../src/engine/systems/acp.js";
import { writeWac } from "../../src/engine/systems/wac.js";
import type {
  EffectivePolicy,
  Grant,
  MigrationPlan,
  Resolutions,
  Subject,
} from "../../src/engine/types.js";
import { FakePod } from "./fake-pod.js";
export const stranger = "https://people.example/stranger#me";
export function grant(
  who: Subject[][] = [[{ kind: "public" }]],
  extra: Partial<Grant> = {},
): Grant {
  return {
    who,
    modes: new Set(["read"]),
    except: [],
    appliesTo: "resource",
    source: {
      url: "https://source.example/pod/.acl",
      node: "https://source.example/pod/.acl#rule",
    },
    ...extra,
  };
}
export function policy(...grants: Grant[]): EffectivePolicy {
  return { grants, denials: [] };
}
export async function acl(
  pod: FakePod,
  resource: string,
  extra = policy(),
  members = resource.endsWith("/"),
): Promise<string> {
  const model = unionPolicies(ownerPolicy(pod.owner, members), extra);
  return pod.system === "wac"
    ? writeWac(model, resource, pod.acl(resource))
    : writeAcp(model, resource, pod.acl(resource));
}
export async function pods(
  from: "wac" | "acp" = "wac",
  to: "wac" | "acp" = "acp",
): Promise<{ source: FakePod; target: FakePod }> {
  const source = new FakePod("https://shared.example/alice/", from);
  const target = new FakePod("https://shared.example/bob/", to);
  await source.initialize(await acl(source, source.root));
  await target.initialize(await acl(target, target.root));
  return { source, target };
}
export function resolve(plan: MigrationPlan, overrides: Record<string, string> = {}): Resolutions {
  return Object.fromEntries(
    plan.report
      .filter((item) => item.severity === "needs-decision")
      .map((item) => [item.id, overrides[item.kind] ?? item.recommended]),
  ) as Resolutions;
}
