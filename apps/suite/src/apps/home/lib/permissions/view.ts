// AUTHORED-BY Codex GPT-6
import { decodeRef, encodeRef } from "../../../../lib/refs";
import type { AgentRow, PermissionLine } from "./types";

export type PermissionsView = "overview" | "advanced";

export function agentName(row: AgentRow): string {
  if (row.kind === "public") return "Anyone with the link";
  if (row.kind === "authenticated") return "Anyone signed in";
  if (row.name?.trim()) return row.name;
  try {
    return new URL(row.id).host || "Unknown account";
  } catch {
    return "Unknown account";
  }
}

export function permissionDate(value?: string): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(value),
      )
    : "Date unknown";
}

export function dataTypeLabel(line: PermissionLine): string {
  if (line.dataType) return line.dataType.label;
  // Binary files have no primary subject. Drive is the suite's known Files location.
  if (
    line.resources.length &&
    line.resources.every((r) => new URL(r.url).pathname.startsWith("/drive/"))
  )
    return "Files";
  return "Other data";
}

export function featureLabel(line: PermissionLine, name: string): string {
  return line.purpose?.label || `Used by ${name}`;
}

export function durationLabel(line: PermissionLine): string {
  return line.expiresAt ? `Until ${permissionDate(line.expiresAt)}` : "Until revoked";
}

export function consequenceText(line: PermissionLine, name: string): string {
  return line.purpose?.label
    ? `${line.purpose.label} will stop working in ${name}`
    : `${name} will lose access to your ${dataTypeLabel(line)}`;
}

export function dataTypeLabels(row: AgentRow): string[] {
  return [...new Set(row.lines.map(dataTypeLabel))];
}

export function revokeCopy(row: AgentRow): { title: string; description: string } {
  const name = agentName(row);
  return {
    title: `Remove all access for ${name}?`,
    description: `${name} will no longer be able to see or change ${dataTypeLabels(row).join(", ") || "your data"}. You can share again later.`,
  };
}

export function visibleRows(
  rows: readonly AgentRow[],
  tab: "people" | "apps",
  search: string,
): AgentRow[] {
  const query = search.trim().toLocaleLowerCase();
  const rank = (row: AgentRow) =>
    row.kind === "public" ? 0 : row.kind === "authenticated" ? 1 : 2;
  return rows
    .filter(
      (row) =>
        (tab === "apps" ? row.kind === "app" : row.kind !== "app") &&
        (!query ||
          [agentName(row), ...dataTypeLabels(row)].some((text) =>
            text.toLocaleLowerCase().includes(query),
          )),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (Date.parse(b.lastChanged || b.since || "") || 0) -
          (Date.parse(a.lastChanged || a.since || "") || 0) ||
        agentName(a).localeCompare(agentName(b)),
    );
}

export function relativePath(url: string, storage: string): string {
  const root = new URL(storage);
  const target = new URL(url);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname))
    return "Outside your pod";
  const path = target.pathname.slice(root.pathname.length);
  try {
    return decodeURIComponent(path) || "/";
  } catch {
    return path;
  }
}

export function parentNames(line: PermissionLine): string[] {
  return [
    ...new Set(
      line.resources
        .filter((r) => r.inherited)
        .map((r) => {
          const url = new URL(r.inheritedFrom || r.url);
          const part = url.pathname.split("/").filter(Boolean).at(-1);
          if (!part) return "your pod";
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        }),
    ),
  ];
}

export function agentHref(row: AgentRow): string {
  if (row.kind === "public" || row.kind === "authenticated") return `/permissions/a/${row.kind}`;
  try {
    return `/permissions/a/${encodeRef(row.id)}`;
  } catch {
    return "/permissions/a/unknown";
  }
}

export function agentId(ref: string): string | undefined {
  if (ref === "public" || ref === "authenticated") return ref;
  try {
    return decodeRef(ref);
  } catch {
    return undefined;
  }
}

export function accessRequestsEnabled(json?: string): boolean {
  try {
    return JSON.parse(json || "{}").accessRequests === true;
  } catch {
    return false;
  }
}
