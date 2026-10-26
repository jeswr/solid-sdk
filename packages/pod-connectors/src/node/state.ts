// AUTHORED-BY Codex GPT-6.1-Sol

import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import type { ConnectorState } from "../core/types.js";
import { writeResource } from "../pod/resource.js";
import { httpsUrl, NodeRuntimeError, object, textValue } from "./errors.js";

const ACL = "http://www.w3.org/ns/auth/acl#";

class OwnerAuthorization extends Authorization {
  get agents(): Set<string> {
    return SetFrom.subjectPredicate(this, `${ACL}agent`, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** Project validated checkpoint fields only; never persist incidental token/error properties. */
export function connectorState(value: unknown): ConnectorState {
  const state = object(value);
  const date = (value: unknown): string => {
    const text = textValue(value);
    if (!Number.isFinite(Date.parse(text))) throw new Error("Invalid state date");
    return text;
  };
  const counts = object(state.counts);
  const count = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw new Error("Invalid state count");
    return value;
  };
  if (state.lastOutcome !== "success" && state.lastOutcome !== "error")
    throw new Error("Invalid state outcome");
  return {
    connectedAt: date(state.connectedAt),
    ...(state.lastSync === undefined ? {} : { lastSync: date(state.lastSync) }),
    ...(state.cursor === undefined ? {} : { cursor: textValue(state.cursor) }),
    lastOutcome: state.lastOutcome,
    counts: {
      documents: count(counts.documents),
      items: count(counts.items),
      skipped: count(counts.skipped),
    },
  };
}

/** Owner-only JSON checkpoint bound to one connector; conditional writes reject lost updates. */
export function createStateStore(options: {
  readonly podRoot: string;
  readonly adapterId: string;
  readonly webId: string;
  readonly fetch: typeof fetch;
}) {
  if (!/^[a-z0-9-]+$/.test(options.adapterId))
    throw new NodeRuntimeError("config", "Invalid connector id.");
  const root = new URL(`integrations/${options.adapterId}/`, options.podRoot).href;
  const webId = httpsUrl(options.webId, true);
  const url = assertWithinPodScope(options.podRoot, new URL("state.json", root).href);
  const fetchSafe = refuseRedirects(options.fetch);
  let etag: string | undefined;
  let loaded = false;
  let exists = false;
  return {
    url,
    async read(): Promise<ConnectorState | undefined> {
      loaded = false;
      try {
        const head = await fetchSafe(url, { method: "HEAD" });
        if (!head.ok && head.status !== 404) throw new Error("State discovery failed");
        const links = [...(head.headers.get("link") ?? "").matchAll(/<([^<>]+)>([^,]*)/g)].filter(
          (link) => {
            const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]*))/.exec(link[2] as string);
            return (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl");
          },
        );
        if (links.length !== 1) throw new Error("No unambiguous WAC ACL link");
        const aclUrl = assertWithinPodScope(root, new URL(links[0]?.[1] as string, url).href, {
          allowRoot: false,
        });
        if (aclUrl === url || new URL(aclUrl).hash || new URL(aclUrl).search)
          throw new Error("Invalid ACL target");
        const dataset = new Store();
        const rule = new OwnerAuthorization(
          DataFactory.namedNode(`${aclUrl}#owner`),
          dataset,
          DataFactory,
        );
        rule.type.add(`${ACL}Authorization`);
        rule.accessTo = url;
        rule.agents.add(webId);
        rule.canRead = true;
        rule.canWrite = true;
        rule.canReadWriteAcl = true;
        // Protection precedes any JSON body read or write; no public/default grants.
        await writeResource(aclUrl, dataset, { fetchImpl: fetchSafe });
        const response = await fetchSafe(url, { headers: { accept: "application/json" } });
        if (response.status === 404) {
          exists = false;
          etag = undefined;
          loaded = true;
          return undefined;
        }
        if (!response.ok || !response.headers.get("etag"))
          throw new Error("Cannot read checkpoint safely");
        const body = await response.text();
        if (body.length > 1024 * 1024) throw new Error("Checkpoint too large");
        const state = connectorState(JSON.parse(body));
        etag = response.headers.get("etag") as string;
        exists = true;
        loaded = true;
        return state;
      } catch {
        throw new NodeRuntimeError("import", "Cannot read or protect connector state.");
      }
    },
    async write(state: ConnectorState): Promise<void> {
      try {
        if (!loaded) throw new Error("Read state before writing");
        const headers = new Headers({ "content-type": "application/json" });
        if (exists) headers.set("if-match", etag as string);
        else headers.set("if-none-match", "*");
        const response = await fetchSafe(url, {
          method: "PUT",
          headers,
          body: JSON.stringify(connectorState(state)),
        });
        if (!response.ok) throw new Error("State write failed");
        // Force a fresh read (and ETag) before another write.
        loaded = false;
      } catch {
        throw new NodeRuntimeError("import", "Cannot save connector state.");
      }
    },
  };
}
