// AUTHORED-BY Codex GPT-6.1-Sol
import {
  ACTION_IRI,
  type OdrlConstraint,
  type OdrlPolicy,
  policyToJsonLd,
} from "@jeswr/solid-odrl";
import { StorageError } from "@jeswr/storage-client";
import { fail } from "./rdf.js";
import type {
  AccessClientOptions,
  AccessMode,
  AccessRequest,
  Grant,
  RevocationKey,
} from "./types.js";

const LWS = "https://www.w3.org/ns/lws#";
const CONTEXT = "https://www.w3.org/ns/lws/v1";
const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
const MEDIA = "application/lws+json";
const ACTIONS = { read: "read", modify: "write", create: "append", delete: "delete" } as const;
const BUILD_ACTIONS = {
  read: "read",
  write: "modify",
  append: "append",
  delete: "delete",
} as const;

function iri(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("Expected an absolute HTTP(S) identifier");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Expected an absolute HTTP(S) identifier");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.href !== value ||
    /[\s\p{Cc}<>"{}|^`\\]/u.test(value)
  )
    throw new TypeError("Expected an absolute HTTP(S) identifier without credentials");
}

/** Strict projection of the supported LWS profile; never flatten unknown restrictions. */
function object(value: unknown, allowed: string[], url: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("invalid-response", url);
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("unsupported", url);
  return value as Record<string, unknown>;
}

function array(value: unknown, url: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail("invalid-response", url);
  return value;
}

function type(value: unknown, expected: string, url: string) {
  const values = array(typeof value === "string" ? [value] : value, url);
  if (values.some((v) => v !== expected && v !== `${LWS}${expected}`)) fail("unsupported", url);
}

interface RecordEntry {
  id: string;
  etag: string | null;
  grants: AccessRequest[];
}

export function createLwsAccess({ storage, storageId, identity }: AccessClientOptions) {
  const unsupported = () => fail("unsupported", storage.root);
  function scoped(url: string) {
    iri(url);
    if (new URL(url).hash || !storage.isWithinStorage(url)) {
      throw new StorageError("scope", { url: storage.root, method: "GET" });
    }
  }
  function service(kind: "accessGrants" | "accessRequests") {
    const feature = storage.features[kind];
    if (
      storage.protocol !== "lws" ||
      (kind === "accessGrants" &&
        (storage.features.accessControl.state !== "available" ||
          storage.features.accessControl.detail.model !== "odrl-grants")) ||
      feature.state !== "available" ||
      !feature.detail.profiles.includes(`${LWS}AccessProfile`) ||
      feature.detail.endpoint === undefined ||
      storageId === undefined
    )
      unsupported();
    iri(storageId);
    const endpoint = feature.detail.endpoint as string;
    scoped(endpoint);
    return endpoint;
  }
  function grant(value: Grant): Grant {
    if (
      !Array.isArray(value.modes) ||
      value.modes.length === 0 ||
      value.modes.some((mode) => !Object.hasOwn(BUILD_ACTIONS, mode))
    )
      unsupported();
    let agent = value.agent;
    if (typeof agent === "string") {
      iri(agent);
      // The reserved public IRI must use the explicit selector.
      if (agent === PUBLIC) unsupported();
    } else if (
      agent !== null &&
      typeof agent === "object" &&
      Object.keys(agent).length === 1 &&
      "public" in agent &&
      agent.public === true
    ) {
      agent = { public: true };
    } else unsupported();
    if (value.purpose !== undefined) iri(value.purpose);
    if (
      value.expires !== undefined &&
      (!(value.expires instanceof Date) ||
        !Number.isFinite(value.expires.getTime()) ||
        !/^\d{4}-/.test(value.expires.toISOString()))
    ) {
      throw new TypeError("Expected an expiry date with a four-digit year");
    }
    return {
      agent,
      modes: [...new Set(value.modes)],
      ...(value.purpose !== undefined && { purpose: value.purpose }),
      ...(value.expires !== undefined && { expires: new Date(value.expires.getTime()) }),
    };
  }
  function constraints(value: unknown, url: string): Pick<Grant, "purpose" | "expires"> {
    const result: Pick<Grant, "purpose" | "expires"> = {};
    if (value === undefined) return result;
    if (!Array.isArray(value)) fail("invalid-response", url);
    for (const item of value) {
      const c = object(item, ["leftOperand", "operator", "rightOperand"], url);
      if (c.leftOperand === "purpose" && c.operator === "eq" && result.purpose === undefined) {
        iri(c.rightOperand);
        result.purpose = c.rightOperand;
      } else if (
        c.leftOperand === "dateTime" &&
        c.operator === "lteq" &&
        result.expires === undefined
      ) {
        // Require timezone-qualified XML Schema dateTime; Date.parse alone accepts dates and rollover.
        const raw = c.rightOperand;
        if (
          typeof raw !== "string" ||
          !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(
            raw,
          ) ||
          !Number.isFinite(Date.parse(raw))
        )
          fail("invalid-response", url);
        const day = raw.slice(0, 10);
        if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
          fail("invalid-response", url);
        result.expires = new Date(raw);
      } else fail("unsupported", url);
    }
    return result;
  }
  function decode(
    value: unknown,
    kind: "AccessGrant" | "AccessRequest",
    id: string,
  ): AccessRequest[] {
    const doc = object(value, ["@context", "id", "type", "storage", "inbox", "access"], id);
    // No context resolution, overrides or untrusted remote loads.
    if (
      !Array.isArray(doc["@context"]) ||
      doc["@context"].length !== 1 ||
      doc["@context"][0] !== CONTEXT
    )
      fail("unsupported", id);
    type(doc.type, kind, id);
    if (doc.storage !== storageId || (doc.id !== undefined && doc.id !== id))
      fail("invalid-response", id);
    if (doc.inbox !== undefined) iri(doc.inbox);
    return array(doc.access, id).flatMap((value) => {
      const access = object(value, ["type", "action", "assignee", "target", "constraint"], id);
      type(access.type, "AccessPolicy", id);
      iri(access.assignee);
      const modes = array(access.action, id).map((action) => {
        if (typeof action !== "string" || !Object.hasOwn(ACTIONS, action)) return unsupported();
        return ACTIONS[action as keyof typeof ACTIONS];
      });
      const target = object(access.target, ["type", "value"], id);
      if (target.type !== "StorageResource" && target.type !== `${LWS}StorageResource`)
        unsupported();
      const limits = constraints(access.constraint, id);
      return array(target.value, id).map((target) => {
        iri(target);
        scoped(target);
        return {
          id,
          target,
          agent:
            access.assignee === PUBLIC ? { public: true as const } : (access.assignee as string),
          modes: [...new Set(modes)],
          ...limits,
          ...(doc.inbox !== undefined && { inbox: doc.inbox as string }),
        };
      });
    });
  }
  async function records(kind: "AccessGrant" | "AccessRequest"): Promise<RecordEntry[]> {
    const endpoint = service(kind === "AccessGrant" ? "accessGrants" : "accessRequests");
    const result: RecordEntry[] = [];
    const seen = new Set<string>();
    for await (const entry of storage.listAll(endpoint)) {
      scoped(entry.url);
      if (entry.kind !== "resource" || entry.url === endpoint || seen.has(entry.url))
        fail("invalid-response", endpoint);
      seen.add(entry.url);
      const read = await storage.read(entry.url, { accept: MEDIA });
      if (
        read.status !== 200 ||
        read.url !== entry.url ||
        read.contentType?.split(";")[0]?.trim().toLowerCase() !== MEDIA
      )
        fail("invalid-response", endpoint);
      let grants: AccessRequest[];
      try {
        grants = decode(JSON.parse(await read.text()), kind, entry.url);
      } catch (error) {
        if (error instanceof StorageError) throw error;
        return fail("invalid-response", entry.url);
      }
      result.push({ id: entry.url, etag: read.etag, grants });
    }
    return result;
  }
  function encode(
    kind: "AccessGrant" | "AccessRequest",
    target: string,
    value: Grant,
    inbox?: string,
  ) {
    const constraints: OdrlConstraint[] = [];
    if (value.purpose !== undefined)
      constraints.push({ leftOperand: "purpose", operator: "eq", rightOperand: value.purpose });
    if (value.expires !== undefined)
      constraints.push({
        leftOperand: "dateTime",
        operator: "lteq",
        rightOperand: value.expires.toISOString(),
      });
    const policy: OdrlPolicy = {
      id: "urn:pod-access:policy",
      type: "Set",
      permissions: value.modes.map((mode) => ({
        type: "permission",
        action: BUILD_ACTIONS[mode as keyof typeof BUILD_ACTIONS],
        target,
        assignee: typeof value.agent === "string" ? value.agent : PUBLIC,
        constraints,
      })),
    };
    // The builder validates all policy fields. LWS's AccessPolicy flattens ODRL permissions,
    // and its create action corresponds precisely to the builder's add-only append action.
    const built = policyToJsonLd(policy) as unknown as {
      permission: {
        action: { "@id": string };
        target: { "@id": string };
        assignee: { "@id": string };
        constraint?: {
          leftOperand: { "@id": string };
          operator: { "@id": string };
          rightOperand: { "@id": string } | { "@value": string };
        }[];
      }[];
    };
    const first = built.permission[0] as (typeof built.permission)[number];
    const short = (iri: string) =>
      iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1);
    const access = {
      type: ["AccessPolicy"],
      action: built.permission.map((p) =>
        p.action["@id"] === ACTION_IRI.append ? "create" : short(p.action["@id"]),
      ),
      assignee: first.assignee["@id"],
      target: { type: "StorageResource", value: [first.target["@id"]] },
      ...(first.constraint !== undefined && {
        constraint: first.constraint.map((c) => ({
          leftOperand: short(c.leftOperand["@id"]),
          operator: short(c.operator["@id"]),
          rightOperand: "@id" in c.rightOperand ? c.rightOperand["@id"] : c.rightOperand["@value"],
        })),
      }),
    };
    return JSON.stringify({
      "@context": [CONTEXT],
      type: [kind],
      ...(inbox !== undefined && { inbox }),
      storage: storageId,
      access: [access],
    });
  }
  async function grants(url: string): Promise<Grant[]> {
    scoped(url);
    return (await records("AccessGrant")).flatMap((record) =>
      record.grants
        .filter((g) => g.target === url)
        .map(({ target: _target, inbox: _inbox, ...grant }) => grant),
    );
  }
  return {
    grants,
    async share(url: string, value: Grant, opts: { inherit?: boolean }): Promise<Grant> {
      const endpoint = service("accessGrants");
      scoped(url);
      if (opts.inherit === true) unsupported();
      const snapshot = grant(value);
      const body = encode("AccessGrant", url, snapshot);
      const result = await storage.create(endpoint, body, { contentType: MEDIA });
      scoped(result.url);
      if (result.url === endpoint) fail("invalid-response", endpoint);
      return { ...snapshot, id: result.url };
    },
    async revoke(url: string, key: RevocationKey): Promise<void> {
      scoped(url);
      let selected: string | "public";
      if (typeof key === "string") {
        iri(key);
        selected = key;
      } else if (
        key !== null &&
        typeof key === "object" &&
        Object.keys(key).length === 1 &&
        "public" in key &&
        key.public === true
      )
        selected = "public";
      else return unsupported();
      const all = await records("AccessGrant");
      const byId = all.some((r) => r.id === selected);
      const matches = (g: Grant) =>
        selected === "public" ? typeof g.agent !== "string" : g.agent === selected;
      const chosen = all.filter((r) =>
        byId
          ? r.id === selected && r.grants.some((g) => g.target === url)
          : r.grants.some((g) => g.target === url && matches(g)),
      );
      // Validate every deletion before the first write: one envelope may cover other resources/agents.
      for (const record of chosen) {
        if (record.grants.some((g) => g.target !== url || (!byId && !matches(g)))) unsupported();
        if (record.etag === null || record.etag.trim() === "" || record.etag.trim() === "*")
          throw new StorageError("precondition-required", {
            url: record.id,
            method: "DELETE",
            status: 428,
          });
      }
      for (const record of chosen)
        await storage.delete(record.id, { ifMatch: record.etag as string });
    },
    async requests(): Promise<readonly AccessRequest[]> {
      return (await records("AccessRequest")).flatMap((r) => r.grants);
    },
    async request(value: AccessRequest): Promise<{ url: string }> {
      const endpoint = service("accessRequests");
      scoped(value.target);
      const snapshot = grant(value);
      const inbox = value.inbox;
      if (inbox !== undefined) iri(inbox);
      const body = encode("AccessRequest", value.target, snapshot, inbox);
      const result = await storage.create(endpoint, body, { contentType: MEDIA });
      scoped(result.url);
      if (result.url === endpoint) fail("invalid-response", endpoint);
      return { url: result.url };
    },
    async effective(url: string): Promise<{ me: AccessMode[]; public: AccessMode[] } | null> {
      service("accessGrants");
      scoped(url);
      const caller = identity?.();
      if (caller === undefined || caller === null) return null;
      iri(caller);
      const entries = await grants(url);
      if (identity?.() !== caller) return null;
      const now = Date.now();
      const active = entries.filter(
        (g) => g.purpose === undefined && (g.expires === undefined || g.expires.getTime() >= now),
      );
      const modes = (values: Grant[]) => [...new Set(values.flatMap((g) => g.modes))];
      const publicGrants = active.filter((g) => typeof g.agent !== "string");
      return {
        me: modes([...active.filter((g) => g.agent === caller), ...publicGrants]),
        public: modes(publicGrants),
      };
    },
  };
}
