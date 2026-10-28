// AUTHORED-BY Codex
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import {
  type AccessState,
  accessControl,
  accessLabel,
  requireAccess,
} from "../src/apps/drive/lib/client/access";
import { ACL, aclBody, OWNER, PRIVATE, ROOT, WacFields, wacPod } from "./drive-wac-pod";

it("distinguishes missing discovery, confirmed missing ACL and the demo declaration", async () => {
  const f = await wacPod();
  const access = accessControl(f.fetch, ROOT);
  expect(await access.snapshot(PRIVATE, new Headers())).toMatchObject({ status: "unknown" });
  expect(
    await access.snapshot(PRIVATE, new Headers({ link: `<${PRIVATE}absent.policy>; rel=acl` })),
  ).toEqual({ status: "none", demo: false });
  expect(
    await access.snapshot(PRIVATE, new Headers({ "x-solid-demo-access-control": "none" })),
  ).toEqual({ status: "none", demo: true });
  expect(
    await access.snapshot(PRIVATE, new Headers({ link: "<https://foreign.test/policy>; rel=acl" })),
  ).toMatchObject({ status: "unknown" });
  expect(
    await access.snapshot(PRIVATE, new Headers({ link: `<${PRIVATE}.policy>; rel=acl` })),
  ).toMatchObject({ status: "known" });
  expect(await access.effective(`${ROOT}missing`)).toMatchObject({ status: "unknown" });
  expect(() => requireAccess({ status: "none", demo: false }, PRIVATE)).toThrow(
    "can't confirm who can access",
  );
});

it.each([
  "missing-validator",
  "weak-validator",
  "unreadable",
  "invalid",
  "acp",
])("policy reads retain unknown for %s, and store never overwrites it", async (mode) => {
  const http: typeof fetch = async () =>
    new Response(
      mode === "invalid"
        ? "invalid turtle"
        : mode === "acp"
          ? "<urn:policy> a <http://www.w3.org/ns/solid/acp#AccessControlResource>."
          : await aclBody(PRIVATE),
      {
        status: mode === "unreadable" ? 403 : 200,
        headers: {
          "content-type": "text/turtle",
          ...(mode === "missing-validator"
            ? {}
            : { etag: mode === "weak-validator" ? 'W/"v1"' : '"v1"' }),
        },
      },
    );
  const access = accessControl(http, ROOT);
  expect(await access.read(`${PRIVATE}.policy`)).toMatchObject({ status: "unknown" });
  await expect(access.store(`${PRIVATE}.policy`, new Store())).rejects.toThrow(
    "can't confirm who can access",
  );
});

it("labels deny-all and unrepresentable grants without claiming exclusive access", () => {
  const empty: AccessState = {
    status: "known",
    policy: { url: `${PRIVATE}.policy`, etag: '"v1"', dataset: new Store() },
  };
  expect(accessLabel(empty, PRIVATE, OWNER)).toBe("No one");
  expect(accessLabel({ status: "none", demo: false }, PRIVATE, OWNER)).toBe("Access unknown");
  expect(accessLabel({ status: "none", demo: true }, PRIVATE, OWNER)).toBe("Only you (demo pod)");
  expect(accessLabel({ status: "unknown", cause: "hidden" }, PRIVATE, OWNER)).toBe(
    "Access unknown",
  );
  const dataset = new Store();
  const rule = new WacFields(DataFactory.blankNode(), dataset, DataFactory);
  rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
  rule.iris(`${ACL}accessTo`).add(PRIVATE);
  rule.iris(`${ACL}agentGroup`).add("https://group.test/#members");
  rule.iris(`${ACL}mode`).add(`${ACL}Read`);
  expect(accessLabel({ ...empty, policy: { ...empty.policy, dataset } }, PRIVATE, OWNER)).toBe(
    "Access unknown",
  );
});
