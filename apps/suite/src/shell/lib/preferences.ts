// AUTHORED-BY Codex GPT-6.1-Sol
import { type AppSlug, defaultRailPins, type RailPreferences, suiteApps } from "@jeswr/suite-ui";

export function parseRailPreferences(value: unknown): RailPreferences {
  if (!value || typeof value !== "object" || !("pinned" in value) || !Array.isArray(value.pinned))
    return { pinned: [...defaultRailPins] };
  return {
    pinned: [
      ...new Set(
        value.pinned.filter((slug): slug is AppSlug => suiteApps.some((app) => app.slug === slug)),
      ),
    ].slice(0, 6),
  };
}
export const RECENT_PROVIDERS_KEY = "suite.recentProviders.v1";
export function recentProviders(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((url): url is string => {
          if (typeof url !== "string") return false;
          try {
            const provider = new URL(url);
            return /^https?:$/.test(provider.protocol) && !provider.username && !provider.password;
          } catch {
            return false;
          }
        }),
      ),
    ].slice(0, 5);
  } catch {
    return [];
  }
}
