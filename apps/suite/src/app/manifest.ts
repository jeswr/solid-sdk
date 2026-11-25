// AUTHORED-BY Codex GPT-6.1-Sol
import { oklchToHex, tokens } from "@jeswr/suite-ui/tokens";
import type { MetadataRoute } from "next";
import { START_PAGE } from "@/shell/lib/next";

// The native build is a static export; the manifest has no request-time inputs.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  // Manifests and PWA tooling do not all accept CSS Color 4 values.
  const light = tokens.find((token) => token.name === "--background")?.light;
  const background = light ? oklchToHex(light) : undefined;
  return {
    id: "/",
    name: "Solid Suite",
    short_name: "Suite",
    description: "Your files, documents, mail, calendar and tasks, together in your own pod.",
    // A route the service worker precaches (not `/`, which only redirects), so launch works offline.
    start_url: START_PAGE,
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    theme_color: background,
    background_color: background,
    categories: ["productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-monochrome.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "monochrome",
      },
    ],
    shortcuts: [
      { name: "Drive", url: "/drive/my" },
      { name: "Docs", url: "/docs" },
      { name: "Mail", url: "/mail" },
      { name: "Calendar", url: "/calendar" },
      { name: "Tasks", url: "/tasks" },
    ],
  };
}
