// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { NanopubStore, purposeFilter } from "../src/index.js";
import { createMemoryPodPort, exampleBuildOptions } from "../src/testing.js";

const identity = { root: "https://example.org/pod/", webId: exampleBuildOptions().owner };
const preamble = `
  @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
  @prefix pd: <https://w3id.org/dpv/pd#> .
  @prefix dpv: <https://w3id.org/dpv#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;
const permission = (restriction: string) => `
  <> a odrl:Set; odrl:permission [
    odrl:action odrl:read; odrl:target pd:Contact; ${restriction}
  ] .
`;
async function setup(body: string) {
  const pod = createMemoryPodPort(identity);
  const store = new NanopubStore(pod);
  await pod.write(store.policyUrl, new TextEncoder().encode(preamble + body), "text/turtle", {});
  const before = await pod.read(store.policyUrl);
  const write = vi.spyOn(pod, "write");
  return { pod, store, before, write };
}

it.each([
  "odrl:duty [ odrl:action <https://example.org/unsupported-duty> ]",
  "odrl:duty [ odrl:target <https://example.org/notice> ]",
  'odrl:duty "not a duty node"',
  "odrl:duty [ odrl:action odrl:inform; odrl:constraint [ odrl:leftOperand odrl:purpose ] ]",
  "odrl:duty [ odrl:action odrl:inform; odrl:consequence [ odrl:action odrl:delete ] ]",
  "odrl:constraint [ odrl:leftOperand <https://example.org/unknown>; odrl:operator odrl:eq; odrl:rightOperand dpv:ServiceProvision ]",
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator <https://example.org/unknown>; odrl:rightOperand dpv:ServiceProvision ]",
  "odrl:constraint [ odrl:operator odrl:eq; odrl:rightOperand dpv:ServiceProvision ]",
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:rightOperand dpv:ServiceProvision ]",
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq ]",
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand [] ]",
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand dpv:ServiceProvision, dpv:Personalisation ]",
  'odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:isAnyOf; odrl:rightOperand dpv:ServiceProvision, "other" ]',
  'odrl:constraint [ odrl:leftOperand odrl:count; odrl:operator odrl:isAnyOf; odrl:rightOperand "1"^^xsd:integer, "2.0"^^xsd:decimal ]',
  'odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq; odrl:rightOperand "purpose"@en ]',
  'odrl:constraint [ odrl:leftOperand odrl:count; odrl:operator odrl:lteq; odrl:rightOperand "invalid"^^xsd:integer ]',
  'odrl:constraint [ odrl:leftOperand odrl:count; odrl:operator odrl:eq; odrl:rightOperand "1"^^<https://example.org/unknown-datatype> ]',
  'odrl:constraint [ odrl:leftOperand odrl:dateTime; odrl:operator odrl:lt; odrl:rightOperand "invalid"^^xsd:dateTime ]',
  "odrl:constraint [ odrl:leftOperand odrl:purpose; odrl:operator odrl:eq, odrl:neq; odrl:rightOperand dpv:ServiceProvision ]",
  "odrl:constraint [ odrl:and ( [ odrl:leftOperand odrl:purpose ] ) ]",
  "odrl:refinement [ odrl:leftOperand odrl:purpose ]",
  'odrl:assignee "not an IRI"',
  "odrl:target pd:EmailAddress",
  "odrl:action odrl:write",
])("rejects a lossy permission before authorization: %s", async (restriction) => {
  const { pod, store, before, write } = await setup(permission(restriction));
  await expect(store.writeDefaultPolicy()).rejects.toThrow();
  expect(await pod.read(store.policyUrl)).toEqual(before);
  expect(write).not.toHaveBeenCalled();
});

it.each([
  "<> a odrl:Set; odrl:permission [ odrl:target pd:Contact ] .",
  "<> a odrl:Set; odrl:permission [ odrl:action <https://example.org/unknown> ] .",
  "<> a odrl:Set; odrl:conflict <https://example.org/unknown> .",
  '<> a odrl:Set; odrl:assignee "not an IRI" .',
  "<> a odrl:Set; odrl:uid <https://example.org/wrong> .",
  "<> a odrl:Set; odrl:profile <https://example.org/unsupported-profile> .",
  "<> a odrl:Set; odrl:obligation [ odrl:action <https://example.org/unsupported-duty> ] .",
  "<> a odrl:Set; odrl:prohibition [ odrl:target pd:Contact ] .",
  "<> a odrl:Set; odrl:prohibition [ odrl:action odrl:read; odrl:duty [ odrl:action odrl:inform ] ] .",
  "<> a odrl:Set . <#second> a odrl:Set; odrl:prohibition [ odrl:action odrl:read ] .",
  "<https://example.org/wrong> a odrl:Set; odrl:permission [ odrl:action odrl:read ] .",
])("rejects unsupported or ambiguous policy terms: %s", async (body) => {
  const { store } = await setup(body);
  await expect(store.writeDefaultPolicy()).rejects.toThrow();
});

it.each([
  "Policy",
  "Set",
  "Offer",
  "Agreement",
])("reads a supported %s policy without weakening its restrictions", async (type) => {
  const { store } = await setup(`
    <> a odrl:${type}; odrl:uid <>; odrl:conflict odrl:prohibit;
      odrl:assigner <https://example.org/owner>; odrl:assignee <https://example.org/client>;
      odrl:permission [ a odrl:Permission; odrl:action odrl:read; odrl:target pd:Contact;
        odrl:constraint <#purpose> ];
      odrl:prohibition [ a odrl:Prohibition; odrl:action odrl:read; odrl:target pd:MedicalHealth ] .
    <#purpose> a odrl:Constraint; odrl:leftOperand odrl:purpose;
      odrl:operator odrl:isAnyOf; odrl:rightOperand dpv:ServiceProvision, dpv:Personalisation .
  `);
  const policy = await store.writeDefaultPolicy();
  const fact = { categories: ["pd:Contact"] };
  expect(purposeFilter(policy, "ServiceProvision", "https://example.org/client")(fact)).toBe(true);
  expect(purposeFilter(policy, "ServiceProvision", "https://example.org/other")(fact)).toBe(false);
  expect(
    purposeFilter(
      policy,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:MedicalHealth"] }),
  ).toBe(false);
});

it.each([
  "duty",
  "obligation",
])("retains known %s actions and shared constraints for requireDuties", async (kind) => {
  const duty = `odrl:${kind} [ a odrl:Duty; odrl:action odrl:inform;
    odrl:target <https://example.org/notice>; odrl:constraint <#purpose> ]`;
  const { store } = await setup(`
    <> a odrl:Set; odrl:permission [ odrl:action odrl:read; odrl:target pd:Contact;
      odrl:constraint <#purpose> ${kind === "duty" ? `; ${duty}` : ""} ]
      ${kind === "obligation" ? `; ${duty}` : ""} .
    <#purpose> odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
      odrl:rightOperand "https://w3id.org/dpv#ServiceProvision" .
  `);
  const policy = await store.writeDefaultPolicy();
  expect(
    purposeFilter(
      policy,
      "ServiceProvision",
      "https://example.org/client",
    )({ categories: ["pd:Contact"] }),
  ).toBe(false);
});

it("preserves numeric and temporal constraints", async () => {
  const { store } = await setup(
    permission(`
    odrl:constraint [ odrl:leftOperand odrl:count; odrl:operator odrl:lteq; odrl:rightOperand 2 ],
      [ odrl:leftOperand odrl:dateTime; odrl:operator odrl:lt; odrl:rightOperand "2027-01-01T00:00:00Z"^^xsd:dateTime ]
  `),
  );
  const policy = await store.writeDefaultPolicy();
  expect(policy.permissions?.[0]?.constraints).toMatchObject([
    { leftOperand: "count", operator: "lteq", rightOperand: 2 },
    { leftOperand: "dateTime", operator: "lt", rightOperand: "2027-01-01T00:00:00Z" },
  ]);
});

it("validates a policy created concurrently before returning it", async () => {
  const pod = createMemoryPodPort(identity);
  const store = new NanopubStore(pod);
  const originalWrite = pod.write;
  pod.write = async (url, body, type, cond) => {
    if (url === store.policyUrl) {
      await originalWrite(
        url,
        new TextEncoder().encode(
          preamble + permission("odrl:duty [ odrl:action <https://example.org/unsupported> ]"),
        ),
        type,
        cond,
      );
      throw Object.assign(new Error("HTTP 412"), { status: 412 });
    }
    return originalWrite(url, body, type, cond);
  };
  await expect(store.writeDefaultPolicy()).rejects.toThrow("Unsupported or malformed");
});
