// AUTHORED-BY Codex GPT-6.1-Sol
import { tokens } from "@jeswr/suite-ui/tokens";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const background = tokens.find((token) => token.name === "--background")?.light;
  return {
    id: "/",
    name: "Solid Suite",
    short_name: "Suite",
    description: "Your files, documents, mail, calendar and tasks, together in your own pod.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
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
