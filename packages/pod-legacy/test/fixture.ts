// AUTHORED-BY Codex GPT-6.1-Sol
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import type { LegacyPlan } from "../src/plan.js";
import { createLegacyStore } from "../src/storage.js";
export const root = "https://alice.example/";
export const owner = `${root}profile/card#me`;
export const url = `${root}settings/legacy-plan.ttl`;
export function plan(): LegacyPlan {
  return {
    owner,
    storage: root,
    enabled: true,
    inactivityMonths: 6,
    warningDays: [30, 7],
    notifyMeBy: ["settings", "tray"],
    created: new Date("2025-01-01T12:00:00Z"),
    modified: new Date("2026-01-31T12:00:00Z"),
    lastActivity: new Date("2026-01-31T12:00:00Z"),
    contacts: [
      {
        webId: "https://alex.example/#me",
        displayName: "Alex",
        scope: "containers",
        mode: "read",
        targets: [`${root}Photos/`, `${root}Documents/`],
      },
    ],
  };
}
export async function fixture() {
  const memory = createMemoryStorage({ protocol: "solid", root });
  await memory.create(root, await writeWac(ownerPolicy(owner, true), root, `${root}.acl`), {
    name: ".acl",
    contentType: "text/turtle",
  });
  const head: typeof memory.head = async (...args) => ({
    ...(await memory.head(...args)),
    links: new Map([["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    try {
      const read =
        request.method === "HEAD" ? await head(request.url) : await memory.read(request.url);
      const headers = new Headers({
        "content-type": read.contentType ?? "text/turtle",
        etag: read.etag ?? "",
        link: `<${request.url}.acl>; rel="acl"`,
      });
      return new Response(request.method === "HEAD" ? null : await read.text(), { headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
  const storage = { ...memory, head };
  const store = createLegacyStore({ storage, owner, fetch });
  return { fetch, storage, store };
}
