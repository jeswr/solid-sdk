// AUTHORED-BY Codex GPT-6
import type { IntegrationAdapter } from "@jeswr/pod-connectors";

const prerequisites: Readonly<Record<string, readonly string[]>> = {
  discord: ["identify"],
  reddit: ["identity"],
};
export const requiredScopesFor = (id: string): readonly string[] => prerequisites[id] ?? [];
export const withRequiredScopes = (id: string, selected: readonly string[]): readonly string[] => [
  ...new Set([...requiredScopesFor(id), ...selected]),
];

interface ScopeRule {
  scopes: readonly string[];
  document: RegExp;
  request: RegExp;
}
const rules: Readonly<Record<string, readonly ScopeRule[]>> = {
  spotify: [
    { scopes: ["user-top-read"], document: /music\/top-/, request: /\/me\/top\// },
    { scopes: ["user-library-read"], document: /saved-tracks/, request: /\/me\/tracks/ },
    { scopes: ["user-follow-read"], document: /followed-artists/, request: /\/me\/following/ },
    {
      scopes: ["user-read-recently-played"],
      document: /recently-played/,
      request: /\/me\/player\/recently-played/,
    },
    {
      scopes: ["playlist-read-private", "playlist-read-collaborative"],
      document: /playlists/,
      request: /\/playlists(?:\/|$)/,
    },
  ],
  github: [
    {
      scopes: ["read:user"],
      document: /profile/,
      request: /never-match-profile-needed-for-repositories/,
    },
    {
      scopes: ["repo"],
      document: /repositories/,
      request: /\/(?:user\/repos|repositories)(?:\/|$)/,
    },
  ],
  discord: [
    { scopes: ["identify"], document: /profile/, request: /never-match-profile-needed-for-guilds/ },
    { scopes: ["guilds"], document: /servers/, request: /\/guilds$/ },
  ],
  reddit: [
    { scopes: ["history"], document: /saved-posts/, request: /\/saved$/ },
    {
      scopes: ["mysubreddits"],
      document: /communities/,
      request: /\/subreddits\/mine\/subscriber$/,
    },
  ],
  strava: [
    {
      scopes: ["activity:read"],
      document: /(?:activities|rides)/,
      request: /\/athlete\/activities$/,
    },
  ],
  dropbox: [{ scopes: ["files.metadata.read"], document: /files/, request: /\/files\// }],
};

/** The package runners have no scope selector. Omit deselected collection reads
 * and writes, and don't call source endpoints for permissions the user withheld.
 * Identity lookups needed to resolve selected collections remain available. */
export function withSelectedScopes(
  adapter: IntegrationAdapter,
  selection: readonly string[],
): IntegrationAdapter {
  const selected = withRequiredScopes(adapter.metadata.id, selection);
  const policy = rules[adapter.metadata.id] ?? [];
  const allowed = (value: string, kind: "document" | "request") => {
    const rule = policy.find((rule) => rule[kind].test(value));
    return !rule || rule.scopes.some((scope) => selected.includes(scope));
  };
  return {
    ...adapter,
    async import(ctx) {
      const outcome = await adapter.import({
        ...ctx,
        api: async (input, init) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          if (allowed(url.pathname, "request")) {
            const response = await ctx.api(input, init);
            if (
              adapter.metadata.id !== "spotify" ||
              !/\/me\/playlists$/.test(url.pathname) ||
              !response.ok
            )
              return response;
            // The list endpoint combines both permissions. Filter before the adapter
            // creates playlist subjects or requests their contents, on every page.
            const page = await response.json();
            if (Array.isArray(page.items))
              page.items = page.items.filter((playlist: { collaborative?: boolean } | null) =>
                selected.includes(
                  playlist?.collaborative === true
                    ? "playlist-read-collaborative"
                    : "playlist-read-private",
                ),
              );
            return Response.json(page, { status: response.status, headers: response.headers });
          }
          const empty =
            adapter.metadata.id === "github" ||
            adapter.metadata.id === "discord" ||
            adapter.metadata.id === "strava"
              ? []
              : adapter.metadata.id === "reddit"
                ? { data: { children: [] } }
                : adapter.metadata.id === "dropbox"
                  ? { entries: [], has_more: false }
                  : /following$/.test(url.pathname)
                    ? { artists: { items: [] } }
                    : { items: [] };
          return Response.json(empty);
        },
        read: (slug) => (allowed(slug, "document") ? ctx.read(slug) : Promise.resolve(undefined)),
        write: (doc, conditions) =>
          allowed(doc.slug, "document")
            ? ctx.write(doc, conditions)
            : Promise.resolve({
                url: ctx.resolve(doc.slug),
                category: doc.category,
                forClass: doc.forClass,
                skipRegistration: true,
              }),
      });
      if (selected.length === adapter.metadata.scopes.length) return outcome;
      // A partial selection cannot advance a checkpoint shared with omitted data.
      const { cursor: _cursor, ...rest } = outcome;
      return { ...rest, ...(ctx.cursor === undefined ? {} : { cursor: ctx.cursor }) };
    },
  };
}
