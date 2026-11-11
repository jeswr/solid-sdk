// AUTHORED-BY Codex GPT-6
// Public configuration belongs to this host, never to pod-connectors. Keep static
// property reads: Next replaces NEXT_PUBLIC_* at build time in browser bundles.
import { createRegistry } from "@jeswr/pod-connectors";
import { catalogue } from "../../lib/connect/catalogue";

function publicConfig(clientId: string | undefined, tokenProxyUrl?: string) {
  return { ...(clientId ? { clientId } : {}), ...(tokenProxyUrl ? { tokenProxyUrl } : {}) };
}
export const registry = createRegistry({
  spotify: publicConfig(process.env.NEXT_PUBLIC_CONNECTOR_SPOTIFY_CLIENT_ID),
  github: publicConfig(
    process.env.NEXT_PUBLIC_CONNECTOR_GITHUB_CLIENT_ID,
    process.env.NEXT_PUBLIC_CONNECTOR_GITHUB_TOKEN_PROXY_URL,
  ),
  strava: publicConfig(
    process.env.NEXT_PUBLIC_CONNECTOR_STRAVA_CLIENT_ID,
    process.env.NEXT_PUBLIC_CONNECTOR_STRAVA_TOKEN_PROXY_URL,
  ),
  reddit: publicConfig(process.env.NEXT_PUBLIC_CONNECTOR_REDDIT_CLIENT_ID),
  discord: publicConfig(
    process.env.NEXT_PUBLIC_CONNECTOR_DISCORD_CLIENT_ID,
    process.env.NEXT_PUBLIC_CONNECTOR_DISCORD_TOKEN_PROXY_URL,
  ),
  twitch: publicConfig(
    process.env.NEXT_PUBLIC_CONNECTOR_TWITCH_CLIENT_ID,
    process.env.NEXT_PUBLIC_CONNECTOR_TWITCH_TOKEN_PROXY_URL,
  ),
  notion: publicConfig(
    process.env.NEXT_PUBLIC_CONNECTOR_NOTION_CLIENT_ID,
    process.env.NEXT_PUBLIC_CONNECTOR_NOTION_TOKEN_PROXY_URL,
  ),
  dropbox: publicConfig(process.env.NEXT_PUBLIC_CONNECTOR_DROPBOX_CLIENT_ID),
});
export const entries = catalogue(
  registry,
  process.env.NEXT_PUBLIC_SHOW_COMING_SOON_CONNECTORS === "1",
);

/** Personal public clients never replace a client configured by the deployment. */
export function spotifyAdapterFor(personalClientId: string) {
  const adapter = registry.adapterById("spotify");
  if (!adapter?.oauth || adapter.oauth.clientId || !/^[a-fA-F0-9]{32}$/.test(personalClientId))
    return adapter;
  return { ...adapter, oauth: { ...adapter.oauth, clientId: personalClientId } };
}
