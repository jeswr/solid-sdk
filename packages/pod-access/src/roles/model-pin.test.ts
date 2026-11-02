// AUTHORED-BY Claude Opus 5.5
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  fixture,
  memoryAccess,
  owner,
  resource,
  root,
  selection,
} from "../../test/roles-helpers.js";
import { ACL, RDF, serialize } from "../rdf.js";
import { addGrant, planAddGrant } from "./client.js";
import { detectModel, isMixedModel, load, mismatchedModel } from "./http.js";
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

describe("detection fails closed on missing, empty and mixed access documents", () => {
  const folder = `${root}folder/`;
  /** An ACP access document governing `url`, optionally also typed as a WAC authorization. */
  async function acpBody(url: string, acr: string, alsoWac = false) {
    const dataset = new Store();
    appendAcp(
      dataset,
      url,
      acr,
      [{ agent: { type: "webid", id: owner }, modes: new Set(["read", "write"] as const) }],
      "ess",
    );
    if (alsoWac)
      dataset.addQuad(
        DataFactory.namedNode(`${acr}#wac`),
        DataFactory.namedNode(`${RDF}type`),
        DataFactory.namedNode(`${ACL}Authorization`),
      );
    return serialize(dataset);
  }

  it("a missing own ACR with an existing ACP ancestor is ACP, not WAC", async () => {
    const mem = memoryAccess("acp");
    mem.advertise(resource, `${resource}?ext=acr`);
    mem.advertise(folder, `${folder}?ext=acr`);
    mem.put(`${folder}?ext=acr`, await acpBody(folder, `${folder}?ext=acr`));
    expect(await detectModel(resource, mem.options)).toEqual({
      model: "acp",
      ownUrl: `${resource}?ext=acr`,
    });
  });

  it("access documents missing or empty at every level are unknown, never WAC", async () => {
    for (const [suffix, body] of [
      ["?ext=acr", undefined],
      [".acl", undefined],
      [".acl", ""],
      [".acr", ""],
    ] as const) {
      const mem = memoryAccess("wac");
      for (const url of [resource, folder, root]) {
        mem.advertise(url, url + suffix);
        if (body !== undefined) mem.put(url + suffix, body);
      }
      expect(await detectModel(resource, mem.options)).toEqual({
        model: "unknown",
        ownUrl: resource + suffix,
      });
      expect(writes(mem)).toEqual([]);
    }
  });

  it("an empty own document defers to the nearest non-empty ancestor", async () => {
    const mem = memoryAccess("wac");
    mem.advertise(resource);
    mem.put(`${resource}.acl`, "");
    mem.attach(folder, await fixture("wac", folder, undefined, true));
    expect((await detectModel(resource, mem.options)).model).toBe("wac");
  });

  it("writing paths still inherit from an existing WAC ancestor when the own ACL is missing", async () => {
    const mem = memoryAccess("wac");
    mem.advertise(resource);
    mem.attach(folder, await fixture("wac", folder, undefined, true));
    const snapshot = await load(resource, { ...mem.options, model: "wac" });
    expect(snapshot).toMatchObject({ model: "wac", ownUrl: `${resource}.acl`, own: undefined });
    expect(snapshot.documents.map(({ url }) => url)).toEqual([`${folder}.acl`]);
  });

  it("tags mixed vocabularies and mixed ancestor models, in detection and in load", async () => {
    const vocabularies = memoryAccess("acp");
    vocabularies.advertise(resource);
    vocabularies.put(`${resource}.acr`, await acpBody(resource, `${resource}.acr`, true));
    const ancestors = memoryAccess("acp");
    ancestors.attach(resource, await fixture("acp"));
    ancestors.advertise(root, `${root}.acl`);
    ancestors.put(`${root}.acl`, await fixture("wac", root, undefined, true));
    for (const [mem, message] of [
      [vocabularies, "Mixed access-control vocabularies"],
      [ancestors, "Mixed ancestor access models"],
    ] as const) {
      for (const step of [detectModel, load]) {
        const error = await step(resource, mem.options).catch((thrown: unknown) => thrown);
        expect(error).toMatchObject({ code: "invalid-response" });
        expect(String(error)).toContain(message);
        expect(isMixedModel(error)).toBe(true);
      }
    }
    const other = await detectModel(resource, { ...memoryAccess().options }).catch(
      (thrown: unknown) => thrown,
    );
    expect(other).toMatchObject({ code: "unsupported" });
    expect(isMixedModel(other)).toBe(false);
    expect(isMixedModel("Mixed ancestor access models")).toBe(false);
  });
});
