// AUTHORED-BY Claude Opus 5.5
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  fixture,
  memoryAccess,
  owner,
  resource,
  root,
  selection,
} from "../../test/roles-helpers.js";
import { serialize } from "../rdf.js";
import { addGrant, planAddGrant } from "./client.js";
import { detectModel, load, mismatchedModel } from "./http.js";
import { isRoleError } from "./index.js";
import { appendAcp } from "./rdf.js";

const grant = { ...selection("editor"), source: resource };
const mutation = (mem: ReturnType<typeof memoryAccess>) => ({ ...mem.options, webId: owner });
const writes = (mem: ReturnType<typeof memoryAccess>) =>
  mem.calls.filter(({ init }) => (init.method ?? "GET") !== "GET" && init.method !== "HEAD");

describe("a pinned access model", () => {
  it("addGrant pinned to WAC refuses an ACP resource advertised with rel=acl and writes nothing", async () => {
    const mem = memoryAccess("acp");
    mem.attach(resource, await fixture("acp"));
    const result = await addGrant([resource], grant, { ...mutation(mem), model: "wac" });
    expect(result.applied).toEqual([]);
    const error = result.failed[0]?.error;
    expect(isRoleError(error) && error.code).toBe("unsupported");
    expect(String(error)).toContain("access model");
    expect(mismatchedModel(error)).toBe("acp");
    await expect(
      planAddGrant([resource], grant, { ...mutation(mem), model: "wac" }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(writes(mem)).toEqual([]);
  });

  it("addGrant pinned to ACP refuses a WAC resource", async () => {
    const mem = memoryAccess("wac");
    mem.attach(resource, await fixture("wac"));
    const result = await addGrant([resource], grant, { ...mutation(mem), model: "acp" });
    expect(mismatchedModel(result.failed[0]?.error)).toBe("wac");
    expect(writes(mem)).toEqual([]);
  });

  it("without a pinned model, or pinned to the model in use, addGrant still writes ACP", async () => {
    for (const model of [undefined, "acp"] as const) {
      const mem = memoryAccess("acp");
      mem.attach(resource, await fixture("acp"));
      const result = await addGrant([resource], grant, {
        ...mutation(mem),
        ...(model && { model }),
      });
      expect(result).toMatchObject({ applied: [resource], failed: [] });
      expect(mem.writes().map(({ url }) => url)).toEqual([`${resource}.acr`]);
    }
  });

  it("other refusals are not reported as a model mismatch", async () => {
    const mem = memoryAccess("wac");
    mem.heads.set(resource, {});
    const result = await addGrant([resource], grant, { ...mutation(mem), model: "wac" });
    expect(result.failed[0]?.error).toMatchObject({ code: "unsupported" });
    expect(mismatchedModel(result.failed[0]?.error)).toBeUndefined();
  });
});

describe("read-only model detection", () => {
  /** ESS: the ACR is advertised with rel="acl" and addressed with a query. */
  async function ess() {
    const mem = memoryAccess("acp");
    const acr = `${resource}?ext=acr`;
    const dataset = new Store();
    appendAcp(
      dataset,
      resource,
      acr,
      [{ agent: { type: "webid", id: owner }, modes: new Set(["read", "write"] as const) }],
      "ess",
    );
    mem.advertise(resource, acr);
    mem.put(acr, await serialize(dataset));
    return { mem, acr };
  }

  it("recognises an ESS ACR advertised only with rel=acl", async () => {
    const { mem, acr } = await ess();
    expect(await detectModel(resource, { fetch: mem.fetch, root })).toEqual({
      model: "acp",
      ownUrl: acr,
    });
    expect(writes(mem)).toEqual([]);
  });

  it("the writing paths keep refusing a query-addressed access document", async () => {
    const { mem } = await ess();
    await expect(load(resource, mem.options)).rejects.toMatchObject({ code: "scope" });
  });

  it("reports WAC, and refuses unsupported when nothing is advertised", async () => {
    const mem = memoryAccess("wac");
    mem.attach(resource, await fixture("wac"));
    expect((await detectModel(resource, mem.options)).model).toBe("wac");
    mem.heads.set(resource, {});
    await expect(detectModel(resource, mem.options)).rejects.toMatchObject({
      code: "unsupported",
    });
  });
});
