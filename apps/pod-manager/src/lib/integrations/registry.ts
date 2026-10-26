// AUTHORED-BY Codex GPT-6.1-Sol
import { createRegistry } from "@jeswr/pod-connectors";
export * from "@jeswr/pod-connectors/registry";

const registry = createRegistry({
  "discord": {
    clientId: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
  },
  "pinterest": {
    clientId: process.env.NEXT_PUBLIC_PINTEREST_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_PINTEREST_TOKEN_PROXY,
  },
  "spotify": {
    clientId: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID,
  },
  "fitbit": {
    clientId: process.env.NEXT_PUBLIC_FITBIT_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_FITBIT_TOKEN_PROXY,
  },
  "strava": {
    clientId: process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_STRAVA_TOKEN_PROXY,
  },
  "google-photos": {
    clientId: process.env.NEXT_PUBLIC_GOOGLE_PHOTOS_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_GOOGLE_PHOTOS_TOKEN_PROXY,
  },
  "youtube": {
    clientId: process.env.NEXT_PUBLIC_YOUTUBE_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_YOUTUBE_TOKEN_PROXY,
  },
  "notion": {
    clientId: process.env.NEXT_PUBLIC_NOTION_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_NOTION_TOKEN_PROXY,
  },
  "google-calendar": {
    clientId: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_TOKEN_PROXY,
  },
  "garmin": {
    clientId: process.env.NEXT_PUBLIC_GARMIN_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_GARMIN_TOKEN_PROXY,
  },
  "github": {
    clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_GITHUB_TOKEN_PROXY,
  },
  "facebook": {
    clientId: process.env.NEXT_PUBLIC_FACEBOOK_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_FACEBOOK_TOKEN_PROXY,
  },
  "x-twitter": {
    clientId: process.env.NEXT_PUBLIC_X_TWITTER_CLIENT_ID,
  },
  "reddit": {
    clientId: process.env.NEXT_PUBLIC_REDDIT_CLIENT_ID,
  },
  "dropbox": {
    clientId: process.env.NEXT_PUBLIC_DROPBOX_CLIENT_ID,
  },
  "slack": {
    clientId: process.env.NEXT_PUBLIC_SLACK_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_SLACK_TOKEN_PROXY,
  },
  "tiktok": {
    clientId: process.env.NEXT_PUBLIC_TIKTOK_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_TIKTOK_TOKEN_PROXY,
  },
  "twitch": {
    clientId: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_TWITCH_TOKEN_PROXY,
  },
  "instagram": {
    clientId: process.env.NEXT_PUBLIC_INSTAGRAM_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_INSTAGRAM_TOKEN_PROXY,
  },
  "linkedin": {
    clientId: process.env.NEXT_PUBLIC_LINKEDIN_CLIENT_ID,
    tokenProxyUrl: process.env.NEXT_PUBLIC_LINKEDIN_TOKEN_PROXY,
  },
});

export const { ADAPTERS, TIER_B_ADAPTERS, ALL_ADAPTERS, adapterById, allCatalogEntries, statusOf } = registry;
