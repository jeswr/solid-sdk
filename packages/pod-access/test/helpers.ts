// AUTHORED-BY Codex GPT-6.1-Sol
import type { EffectivePolicy, Grant, Subject } from "../src/types.js";
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
