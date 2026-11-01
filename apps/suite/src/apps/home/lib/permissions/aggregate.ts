// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Aggregation ported from apps/access-manager/src/lib/grants.ts (byAgent / shareLines).
import type { Subject } from "@jeswr/pod-access";
import { DataFactory } from "n3";
import type { Classification } from "../model/domains";
import { httpUrl } from "../model/rdf";
import { mergeRecord, recordForGrant } from "./records";
import type {
  AgentRow,
  GrantRecordIndex,
  ModeId,
  PermissionsSnapshot,
  RoleId,
  WalkedAccess,
} from "./types";
import { authorizationTurtle, clauseSignature, grantSignature } from "./vocab";

export function classifyAgent(subject: Subject): Pick<AgentRow, "kind" | "key" | "id"> | undefined {
  switch (subject.kind) {
    case "public":
    case "authenticated":
      return { kind: subject.kind, key: subject.kind, id: subject.kind };
    case "origin":
      return { kind: "app", key: subject.origin, id: subject.origin };
    case "client":
      return { kind: "app", key: subject.clientId, id: subject.clientId };
    case "agent": {
      const url = httpUrl(subject.webId);
      const app =
        url?.protocol === "https:" &&
        !url.hash &&
        (/\.json(?:ld)?$/i.test(url.pathname) ||
          /(?:^|\/)client[_-]?id(?:\/|$)/i.test(url.pathname));
      return { kind: app ? "app" : "person", key: subject.webId, id: subject.webId };
    }
    default:
      return undefined;
  }
}
const ORDER: ModeId[] = ["read", "append", "write", "control"];
export function unionModes(modes: Iterable<ModeId>): ModeId[] {
  const set = new Set(modes);
  if (set.has("write")) set.add("append");
  return ORDER.filter((mode) => set.has(mode));
}
export function roleForModes(modes: Iterable<ModeId>): RoleId {
  const set = new Set(modes);
  if (set.has("control")) return "manager";
  if (set.has("write")) return "editor";
  if (set.has("append")) return "commenter";
  return "viewer";
}
export function modeLabel(mode: ModeId): string {
  return { read: "Read", write: "Change", append: "Add", control: "Manage access" }[mode];
}
export function roleLabel(role: RoleId): string {
  return {
    viewer: "Can see",
    commenter: "Can comment",
    editor: "Can change",
    manager: "Can manage access",
  }[role];
}
export function aggregateHoldings(
  nodes: readonly WalkedAccess[],
  ctx: {
    webId: string;
    classify(url: string): Classification | undefined;
    records?: GrantRecordIndex;
  },
): Omit<PermissionsSnapshot, "failures" | "truncated"> {
  nodes = nodes.map((node) => ({
    ...node,
    policy: {
      ...node.policy,
      grants: node.policy.grants.flatMap((grant) =>
        !node.inherited && node.isContainer && grant.appliesTo === "both"
          ? [
              { ...grant, appliesTo: "resource" as const },
              { ...grant, appliesTo: "members" as const },
            ]
          : [grant],
      ),
    },
  }));
  const rows = new Map<string, AgentRow>();
  const publicItems = new Set<string>();
  for (const node of nodes) {
    const classification = ctx.classify(node.url);
    for (const grant of node.policy.grants) {
      // Unmodelled restrictions must not turn into unconditional display rows.
      if (grant.except.length || node.policy.denials.length || !grant.modes.size) continue;
      const applies = node.inherited
        ? grant.appliesTo !== "resource"
        : grant.appliesTo !== "members";
      for (const clause of grant.who) {
        if (clause.some((subject) => !classifyAgent(subject))) continue;
        for (const subject of clause) {
          const agent = classifyAgent(subject) as NonNullable<ReturnType<typeof classifyAgent>>;
          if (agent.id === ctx.webId) continue;
          if (
            agent.kind === "public" &&
            clause.every((atom) => atom.kind === "public") &&
            applies &&
            grant.modes.has("read")
          )
            publicItems.add(node.url);
          // Compact only descendants of the same data type. Other types still point
          // at the governing parent when revoked, but must remain visible.
          if (
            node.inherited &&
            nodes.some(
              (ancestor) =>
                ancestor.isContainer &&
                ancestor.url !== node.url &&
                node.url.startsWith(ancestor.url) &&
                (!classification?.dataType ||
                  ctx.classify(ancestor.url)?.dataType?.id === classification.dataType.id) &&
                ancestor.policy.grants.some(
                  (other) =>
                    other.source.url === grant.source.url &&
                    other.source.node === grant.source.node &&
                    other.appliesTo !== "resource",
                ),
            )
          )
            continue;
          const inherited = node.inherited || grant.appliesTo === "members";
          const scope = inherited ? "members" : "resource";
          const inheritedFrom = inherited ? (node.inheritedFrom ?? node.url) : undefined;
          const record = mergeRecord(
            node.records?.get(grant.source.node) ?? {},
            recordForGrant(
              ctx.records,
              grant.source.node,
              agent.id,
              node.inheritedFrom ?? node.url,
              grant.modes,
            ),
          );
          const conditions = clause.filter((atom) => atom !== subject);
          let row = rows.get(agent.key);
          if (!row) {
            row = { ...agent, lines: [] };
            rows.set(agent.key, row);
          }
          if (record.created && (!row.since || record.created < row.since))
            row.since = record.created;
          const changed = record.modified ?? record.created;
          if (changed && (!row.lastChanged || changed > row.lastChanged)) row.lastChanged = changed;
          const key = JSON.stringify([
            agent.key,
            classification?.dataType?.id,
            grant.source.url,
            inheritedFrom,
            record.purpose?.iri,
            record.purpose?.label,
            record.expiresAt,
            clauseSignature(conditions),
          ]);
          let line = row.lines.find((line) => line.key === key);
          if (!line) {
            line = {
              key,
              dataType: classification?.dataType
                ? { id: classification.dataType.id, label: classification.dataType.label }
                : undefined,
              domainId: classification?.domain.id ?? "other",
              resources: [],
              role: "viewer",
              modes: [],
              inherited,
              ...(conditions.length ? { conditions } : {}),
              ...(record.purpose ? { purpose: record.purpose } : {}),
              ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
            };
            row.lines.push(line);
          }
          const existing = line.resources.find(
            (r) =>
              r.url === node.url &&
              r.node === grant.source.node &&
              JSON.stringify(r.subject) === JSON.stringify(subject),
          );
          if (existing) {
            existing.modes = unionModes([...existing.modes, ...grant.modes]);
            existing.signature = grantSignature({ ...grant, modes: new Set(existing.modes) });
          } else
            line.resources.push({
              url: node.url,
              isContainer: node.isContainer,
              modes: unionModes(grant.modes),
              inherited,
              ...(inheritedFrom ? { inheritedFrom } : {}),
              source: grant.source.url,
              node: grant.source.node,
              subject,
              clause,
              signature: grantSignature(grant),
              ...(node.dataset
                ? {
                    authorization: authorizationTurtle(
                      node.dataset,
                      grant.source.node.includes(":")
                        ? DataFactory.namedNode(grant.source.node)
                        : DataFactory.blankNode(grant.source.node),
                    ),
                  }
                : {}),
              system: node.system,
              scope,
            });
          line.modes = unionModes([...line.modes, ...grant.modes]);
          line.role = roleForModes(line.modes);
          line.inherited = line.resources.every((r) => r.inherited);
        }
      }
    }
  }
  const rank = (row: AgentRow) =>
    row.kind === "public" ? 0 : row.kind === "authenticated" ? 1 : 2;
  const sorted = [...rows.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (Date.parse(b.lastChanged ?? "") || 0) - (Date.parse(a.lastChanged ?? "") || 0) ||
      (a.name ?? a.id).localeCompare(b.name ?? b.id),
  );
  return {
    rows: sorted,
    summary: {
      apps: sorted.filter((r) => r.kind === "app").length,
      people: sorted.filter((r) => r.kind === "person").length,
      publicItems: publicItems.size,
    },
  };
}
