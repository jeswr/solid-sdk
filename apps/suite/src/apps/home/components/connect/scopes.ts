// AUTHORED-BY Codex GPT-6
import type { IntegrationAdapter } from "@jeswr/pod-connectors";

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
  selected: readonly string[],
): IntegrationAdapter {
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
          if (allowed(url.pathname, "request")) return ctx.api(input, init);
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
