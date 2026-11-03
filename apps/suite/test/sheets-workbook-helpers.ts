// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import { ProfileTypeIndexAnchor, TypeIndexDocument } from "../src/apps/docs/lib/model/type-index";
import type { Snapshot } from "../src/apps/sheets/lib/contract";
import { SheetResource } from "../src/apps/sheets/lib/model";
import { csvToWorkbook } from "../src/apps/sheets/lib/univer-spike";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { createDemoPod } from "../src/lib/demo-pod/pod";

export const POD = "https://pod.example/alice/";
export const ROOT = `${POD}sheets/`;
export const WEBID = `${POD}profile/card#me`;
export const INDEX = `${POD}settings/privateTypeIndex.ttl`;
export const NOW = new Date("2026-11-01T10:00:00Z");
export const CSV = 'Label,Amount,When\r\n"Text, quoted",42.5,2026-10-25\r\n';
export function snapshot(csv = CSV, extra = false): Snapshot {
  return csvToWorkbook("original", "Original", [
    { id: "data", name: "Data", csv },
    ...(extra ? [{ id: "other", name: "Other", csv: "Other\r\nvalue\r\n" }] : []),
  ]) as unknown as Snapshot;
}

export interface Call {
  url: string;
  method: string;
  headers: Headers;
  init: RequestInit;
}
export type Hook = (call: Call) => Response | undefined | Promise<Response | undefined>;

export async function harness(index = false) {
  const profile = new Store();
  if (index) new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).privateIndex = INDEX;
  const indexDataset = new Store();
  new TypeIndexDocument(INDEX, indexDataset, DataFactory).markUnlistedIndex();
  const acl = new Store();
  const owner = new SheetResource(`${INDEX}.acl#owner`, acl, DataFactory);
  const Acl = "http://www.w3.org/ns/auth/acl#";
  owner.types.add(`${Acl}Authorization`);
  owner.links(`${Acl}accessTo`).add(INDEX);
  owner.links(`${Acl}agent`).add(WEBID);
  for (const mode of ["Read", "Write", "Control"]) owner.links(`${Acl}mode`).add(`${Acl}${mode}`);
  const pod = createDemoPod({
    root: POD,
    seed: [
      { path: "profile/card", body: await serializeTurtle(profile), contentType: "text/turtle" },
      ...(index
        ? [
            {
              path: "settings/privateTypeIndex.ttl",
              body: await serializeTurtle(indexDataset),
              contentType: "text/turtle",
            },
            {
              path: "settings/privateTypeIndex.ttl.acl",
              body: await serializeTurtle(acl),
              contentType: "text/turtle",
            },
          ]
        : []),
    ],
  });
  const calls: Call[] = [];
  let hook: Hook = () => undefined;
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const call = {
      url: String(input),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      init,
    };
    calls.push(call);
    return (await hook(call)) ?? pod.fetch(input, init);
  };
  let date = NOW;
  const options = { podRoot: POD, webId: WEBID, fetch, now: () => date };
  return {
    pod,
    calls,
    fetch,
    options,
    service: createWorkbookService(options),
    storage: (await import("../src/apps/sheets/lib/model")).createSheetStorage(fetch, POD),
    setHook: (next: Hook) => {
      hook = next;
    },
    setDate: (next: Date) => {
      date = next;
    },
  };
}

/** Real typed LDP listing, including intentionally foreign containment entries. */
export async function listing(url: string, members: { url: string; container: boolean }[]) {
  const dataset = new Store();
  const Ldp = "http://www.w3.org/ns/ldp#";
  const self = new SheetResource(url, dataset, DataFactory);
  self.types.add(`${Ldp}BasicContainer`);
  for (const member of members) {
    self.links(`${Ldp}contains`).add(member.url);
    if (member.container)
      new SheetResource(member.url, dataset, DataFactory).types.add(`${Ldp}BasicContainer`);
  }
  return new Response(await serializeTurtle(dataset), {
    headers: { "content-type": "text/turtle" },
  });
}
