// AUTHORED-BY Codex GPT-6.1-Sol
import { type InboxNotification, notificationKind } from "@jeswr/pod-access/notify";

export type SharedApp =
  | "docs"
  | "sheets"
  | "notes"
  | "tasks"
  | "calendar"
  | "photos"
  | "music"
  | "drive";
export interface SharedItem {
  url: string;
  name: string;
  app: SharedApp;
  kind: string;
  /** Sender assertion from the notification, not a verified identity. */
  sharedBy?: string;
  sharedAt?: string;
  role?: string;
  source: "inbox" | "opened" | "app";
}
export interface SharedItemHints {
  url: string;
  name?: string;
  contentType?: string;
  rdfTypes?: readonly string[];
}

/** Never expose credentialed or non-HTTP resource links. No I/O or permission inference. */
export function isSharedItemUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function sharedItemName(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);
  } catch {
    return value;
  }
}

const rules: readonly {
  app: SharedApp;
  kind: string;
  mime: RegExp;
  type: RegExp;
  extension: RegExp;
  path: RegExp;
}[] = [
  {
    app: "sheets",
    kind: "spreadsheet",
    mime: /(?:spreadsheet|excel|text\/csv)/,
    type: /(?:#|\/)(?:Spreadsheet|SpreadsheetDigitalDocument)$/,
    extension: /\.(?:csv|xlsx?|ods)$/,
    path: /(?:^|\/)(?:sheets|pod-sheets)(?:\/|$)/,
  },
  {
    app: "notes",
    kind: "note",
    mime: /^application\/vnd\.jeswr\.note$/,
    type: /(?:#|\/)(?:Note|TextDigitalDocument)$/,
    extension: /\.note$/,
    path: /(?:^|\/)(?:notes|pod-notes)(?:\/|$)/,
  },
  {
    app: "tasks",
    kind: "task-list",
    mime: /^application\/vnd\.jeswr\.tasks$/,
    type: /(?:#|\/)(?:Tracker|TaskList|Task|Vtodo)$/,
    extension: /\.(?:todo|vtodo)$/,
    path: /(?:^|\/)(?:tasks|pod-tasks)(?:\/|$)/,
  },
  {
    app: "calendar",
    kind: "calendar",
    mime: /^text\/calendar$/,
    type: /(?:#|\/)(?:Calendar|CalendarEvent|Vcalendar|Vevent)$/,
    extension: /\.ics$/,
    path: /(?:^|\/)(?:calendar|calendars|pod-calendar)(?:\/|$)/,
  },
  {
    app: "photos",
    kind: "photo",
    mime: /^image\//,
    type: /(?:#|\/)(?:ImageObject|Photograph|Photo|PhotoAlbum)$/,
    extension: /\.(?:avif|gif|heic|jpe?g|png|svg|webp)$/,
    path: /(?:^|\/)(?:photos|pod-photos)(?:\/|$)/,
  },
  {
    app: "music",
    kind: "audio",
    mime: /^audio\//,
    type: /(?:#|\/)(?:MusicRecording|MusicAlbum|MusicPlaylist|AudioObject|Track)$/,
    extension: /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/,
    path: /(?:^|\/)(?:music|pod-music)(?:\/|$)/,
  },
  {
    app: "docs",
    kind: "document",
    mime: /^(?:text\/(?:plain|markdown|html)|application\/(?:msword|rtf|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.oasis\.opendocument\.text))$/,
    type: /(?:#|\/)(?:Document|DigitalDocument)$/,
    extension: /\.(?:docx?|md|markdown|odt|rtf|txt|html?)$/,
    path: /(?:^|\/)(?:docs|pod-docs)(?:\/|$)/,
  },
];

const subtypes: readonly { app: SharedApp; kind: string; type: RegExp; path: RegExp }[] = [
  {
    app: "photos",
    kind: "album",
    type: /(?:#|\/)PhotoAlbum$/,
    path: /(?:^|\/)(?:photos|pod-photos)\/albums\/[^/]+(?:\.ttl|\/)$/,
  },
  {
    app: "calendar",
    kind: "event",
    type: /(?:#|\/)(?:CalendarEvent|Vevent)$/,
    path: /(?:^|\/)(?:calendar|calendars|pod-calendar)\/[^/]+\/[^/]+\.ttl$/,
  },
  {
    app: "music",
    kind: "playlist",
    type: /(?:#|\/)MusicPlaylist$/,
    path: /(?:^|\/)(?:music|pod-music)\/playlists\/[^/]+(?:\.ttl|\/)$/,
  },
  {
    app: "music",
    kind: "album",
    type: /(?:#|\/)MusicAlbum$/,
    path: /(?:^|\/)(?:music|pod-music)\/albums\/[^/]+(?:\.ttl|\/)$/,
  },
];

/** Explicit media/RDF metadata wins over filename, then decoded path hints. */
export function classifySharedItem(hints: SharedItemHints): Pick<SharedItem, "app" | "kind"> {
  if (!isSharedItemUrl(hints.url)) return { app: "drive", kind: "file" };
  const url = new URL(hints.url);
  const mime = hints.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const typed =
    rules.find((rule) => rule.mime.test(mime)) ??
    rules.find((rule) => hints.rdfTypes?.some((type) => rule.type.test(type)));
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Keep malformed encodings opaque. */
  }
  const name = (hints.name ?? path).toLowerCase();
  const rule =
    typed ??
    rules.find((rule) => rule.extension.test(name)) ??
    rules.find((rule) => rule.extension.test(path.toLowerCase())) ??
    rules.find((rule) => rule.path.test(path.toLowerCase()));
  const subtype = subtypes.find(
    (subtype) =>
      subtype.app === rule?.app &&
      (hints.rdfTypes?.some((type) => subtype.type.test(type)) ||
        subtype.path.test(path.toLowerCase())),
  );
  return rule
    ? { app: rule.app, kind: subtype?.kind ?? rule.kind }
    : { app: "drive", kind: path.endsWith("/") ? "folder" : "file" };
}

/** Drive's native Docs scope: direct .ttl children of docs/ or legacy pod-docs/. */
export function isSuiteDocsDocument(url: string, storageUrl: string): boolean {
  if (!isSharedItemUrl(url) || !isSharedItemUrl(storageUrl) || !url.endsWith(".ttl")) return false;
  const parsed = new URL(url);
  return ["docs/", "pod-docs/"].some((slug) => {
    const parent = new URL(slug, storageUrl);
    const rest = parsed.pathname.slice(parent.pathname.length);
    return (
      parsed.origin === parent.origin &&
      parsed.pathname.startsWith(parent.pathname) &&
      !parsed.search &&
      !parsed.hash &&
      !!rest &&
      !rest.includes("/") &&
      !/%2f|%5c/i.test(rest)
    );
  });
}

/** Only the suite share Announce shape; assignments, mentions and invitations stay separate. */
export function sharedItemsFromInbox(notifications: readonly InboxNotification[]): SharedItem[] {
  return mergeSharedItems(
    notifications.flatMap((notification): SharedItem[] => {
      if (
        notificationKind(notification) !== "share" ||
        !notification.object ||
        !isSharedItemUrl(notification.object)
      )
        return [];
      const role = notification.summary?.slice("Shared with you as ".length).trim();
      return [
        {
          url: notification.object,
          name: notification.content?.trim() || sharedItemName(notification.object),
          ...classifySharedItem({ url: notification.object }),
          ...(notification.actor ? { sharedBy: notification.actor } : {}),
          ...(Number.isFinite(Date.parse(notification.published ?? ""))
            ? { sharedAt: notification.published }
            : {}),
          ...(role ? { role } : {}),
          source: "inbox",
        },
      ];
    }),
  );
}

function timestamp(value: string | undefined): number {
  const date = Date.parse(value ?? "");
  return Number.isFinite(date) ? date : -Infinity;
}

/** Extracted from Drive: latest occurrence wins, later entry wins equal dates, undated last. */
export function latestSharedEntries<T extends { url: string }>(
  entries: readonly T[],
  date: (entry: T) => string | undefined,
): T[] {
  const latest = new Map<string, T>();
  for (const entry of entries) {
    const previous = latest.get(entry.url);
    if (!previous || timestamp(date(entry)) >= timestamp(date(previous)))
      latest.set(entry.url, entry);
  }
  return [...latest.values()].sort(
    (a, b) => timestamp(date(b)) - timestamp(date(a)) || a.url.localeCompare(b.url),
  );
}

/** Newest metadata wins conflicts; fill missing fields and inferred names/apps from richer sources. */
export function mergeSharedItems(...sources: readonly (readonly SharedItem[])[]): SharedItem[] {
  const entries = sources.flat().filter((item) => isSharedItemUrl(item.url));
  entries.sort(
    (a, b) => timestamp(b.sharedAt) - timestamp(a.sharedAt) || a.url.localeCompare(b.url),
  );
  const merged = new Map<string, SharedItem>();
  for (const item of entries) {
    const previous = merged.get(item.url);
    if (!previous) {
      merged.set(item.url, { ...item });
      continue;
    }
    merged.set(item.url, {
      ...item,
      ...previous,
      name:
        previous.name.trim() && previous.name !== sharedItemName(previous.url)
          ? previous.name
          : item.name || previous.name,
      ...(previous.app === "drive" && item.app !== "drive"
        ? { app: item.app, kind: item.kind }
        : {}),
      sharedBy: previous.sharedBy || item.sharedBy,
      sharedAt: previous.sharedAt || item.sharedAt,
      role: previous.role || item.role,
    });
  }
  return [...merged.values()];
}

/** Same key scheme as Tasks' per-account Shared with me list. Storage belongs to the app. */
export function sharedAccountKey(webId: string, namespace = "suite.shared.hidden"): string {
  return `${namespace}:${encodeURIComponent(webId)}`;
}

/** A stored list is untrusted. Keep valid entries only, with the last value for each URL. */
export function parseSharedEntries<T extends { url: string }>(
  raw: string | null,
  valid: (value: unknown) => value is T,
): T[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value)
      ? [...new Map(value.filter(valid).map((entry) => [entry.url, entry])).values()]
      : [];
  } catch {
    return [];
  }
}

/** Never carry an in-memory list across sign-out/account changes when storage is unavailable. */
export function sharedItemsForAccount<T>(
  owner: string | undefined,
  snapshot: { owner?: string | undefined; items: readonly T[] },
): readonly T[] {
  return owner && owner === snapshot.owner ? snapshot.items : [];
}
export function removeSharedItem<T extends { url: string }>(items: readonly T[], url: string): T[] {
  return items.filter((item) => item.url !== url);
}
export function hideSharedItem(hidden: readonly { url: string }[], url: string): { url: string }[] {
  return isSharedItemUrl(url) ? [...removeSharedItem(hidden, url), { url }] : [...hidden];
}
export function visibleSharedItems<T extends { url: string }>(
  items: readonly T[],
  hidden: readonly { url: string }[],
): T[] {
  const urls = new Set(hidden.map((item) => item.url));
  return items.filter((item) => !urls.has(item.url));
}
export function isSharedUrlEntry(value: unknown): value is { url: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "url" in value &&
    typeof value.url === "string" &&
    isSharedItemUrl(value.url)
  );
}
