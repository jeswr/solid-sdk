// AUTHORED-BY Claude Opus 5.5
/**
 * Search items for the demo account, derived from the demo pod's seed so the
 * TopBar search and /search show real results before SDK-APP-09 lands.
 */
import { type ChipRef, chipHref } from "@jeswr/suite-sdk/chips/core";
import type { AppSlug } from "@jeswr/suite-ui";
import { DEMO_ROOT, DEMO_WEBID } from "../../lib/demo-pod/seed";
import { encodeRef } from "../../lib/refs";
import type { LocalSearchItem } from "./local-source";

interface SeedEntry {
  readonly path: string;
  readonly search?: ChipRef;
  readonly contentType?: string;
  readonly modified?: number;
}

export function demoSearchItems(seed: readonly SeedEntry[]): LocalSearchItem[] {
  const resources: LocalSearchItem[] = seed.flatMap((entry) =>
    entry.search
      ? [
          {
            id: entry.search.iri,
            title: entry.search.label,
            type:
              entry.search.kind === "person"
                ? "person"
                : entry.search.kind === "task"
                  ? "task"
                  : entry.search.kind === "file"
                    ? "file"
                    : ["doc", "note", "sheet"].includes(entry.search.kind)
                      ? "document"
                      : "data",
            app: (entry.search.app ??
              (
                {
                  person: "contacts",
                  file: "drive",
                  doc: "docs",
                  sheet: "sheets",
                  note: "notes",
                  event: "calendar",
                  task: "tasks",
                } as Record<string, AppSlug>
              )[entry.search.kind] ??
              "drive") as AppSlug,
            href: chipHref(entry.search, encodeRef),
            owner: DEMO_WEBID,
          },
        ]
      : [],
  );
  return [
    ...resources,
    ...seed
      .filter((file) => file.path.startsWith("drive/") && file.path !== "drive/")
      .map((file) => {
        const url = DEMO_ROOT + file.path;
        const folder = file.path.endsWith("/");
        const segments = file.path.replace(/\/$/u, "").split("/");
        const title = decodeURIComponent(segments.at(-1) ?? file.path);
        const parent = ["My Drive", ...segments.slice(1, -1).map(decodeURIComponent)].join(" / ");
        return {
          id: url,
          title,
          type: "file" as const,
          app: "drive" as const,
          href: folder ? `/drive/f/${encodeRef(url)}` : `/drive/p/${encodeRef(url)}`,
          parent,
          owner: DEMO_WEBID,
          ...(file.modified ? { modified: new Date(file.modified) } : {}),
        };
      }),
  ];
}
