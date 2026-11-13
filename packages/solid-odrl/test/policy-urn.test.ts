// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import {
  OdrlSerializationError,
  parsePolicy,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
} from "../src/policy.js";
import type { OdrlPolicy } from "../src/types.js";

const fields = [
  "target",
  "assignee",
  "assigner",
  "profile",
  "policyAssignee",
  "policyAssigner",
  "dutyTarget",
] as const;
function policy(field: (typeof fields)[number], value: string | undefined): OdrlPolicy {
  return {
    id: "urn:test:policy",
    type: "Set",
    ...(field === "profile" ? { profile: value } : {}),
    ...(field === "policyAssignee" ? { assignee: value } : {}),
    ...(field === "policyAssigner" ? { assigner: value } : {}),
    permissions: [
      {
        type: "permission",
        action: "read",
        ...(["target", "assignee", "assigner"].includes(field) ? { [field]: value } : {}),
        ...(field === "dutyTarget" ? { duties: [{ action: "inform", target: value }] } : {}),
      },
    ],
  };
}
const accepted = [
  "http://example.org/a",
  "https://example.org:443/a#b",
  "urn:scenario:age-check:document",
  "URN:EXAMPLE:a",
  "urn:ab:x",
  `urn:${"a".repeat(32)}:x`,
  "urn:a-b:a/b:c@d!$&'()*+,;=._~-",
  "urn:ab:%20%2F",
  "urn:ab:a?+resolve/path?x?=query/path?x#frag/?",
];
const rejected = [
  "",
  "relative",
  "/relative",
  "//example.org/a",
  "_:blank",
  "javascript:alert(1)",
  "data:text/plain,x",
  "file:///tmp/a",
  "did:example:a",
  "ftp://example.org/a",
  "urn:ab:",
  "urn:a:x",
  `urn:${"a".repeat(33)}:x`,
  "urn:-ab:x",
  "urn:ab-:x",
  "urn:a_b:x",
  "urn:ab:/x",
  "urn:ab:%",
  "urn:ab:%gg",
  "urn:ab:a?",
  "urn:ab:a?+",
  "urn:ab:a?=",
  "urn:ab:a?+x?=",
  "https://example.org/a\u00a0b",
  " urn:ab:a",
  "urn:ab:a ",
  "urn:ab:a\u00a0b",
  ...Array.from({ length: 33 }, (_, i) => `urn:ab:a${String.fromCharCode(i)}b`),
  ...Array.from('<>"{}|^`\\', (char) => `urn:ab:a${char}b`),
];
describe.each(fields)("evaluation-critical %s", (field) => {
  it.each(accepted)("preserves %s in every serializer and RDF round trip", async (value) => {
    const input = policy(field, value);
    const quads = policyToRdf(input);
    expect(quads.some((q) => q.object.value === value)).toBe(true);
    expect(JSON.stringify(policyToJsonLd(input))).toContain(value);
    const parsed = await parsePolicy(await policyToTurtle(input));
    expect(parsed).toBeDefined();
    const request = { action: "read", target: value, agent: value };
    expect(evaluate(parsed!, request).decision).toBe(evaluate(input, request).decision);
    expect(policyToRdf(parsed!).some((q) => q.object.value === value)).toBe(true);
  });
  it.each(rejected)("refuses %j without dropping the explicit field", (value) => {
    for (const serialize of [policyToRdf, policyToJsonLd, policyToTurtle])
      expect(() => serialize(policy(field, value))).toThrow(OdrlSerializationError);
  });
  it("retains a genuinely absent field", () => {
    for (const serialize of [policyToRdf, policyToJsonLd, policyToTurtle])
      expect(() => serialize(policy(field, undefined))).not.toThrow();
  });
});
