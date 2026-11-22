// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { onest, sourceCode, sourceSerif } from "@jeswr/suite-ui/fonts";
import { oklchToHex, tokens } from "@jeswr/suite-ui/tokens";
import type { Metadata, Viewport } from "next";
import { NativeStartupGate } from "@/components/native-startup-gate";
import { suiteEnv } from "@/shell/lib/env";
import { Providers } from "./providers";
import "./globals.css";

const background = tokens.find((token) => token.name === "--background");
if (!background) throw new Error("suite-ui tokens lack --background");
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    // Hex: older browsers drop an oklch() theme-color.
    {
      media: "(prefers-color-scheme: light)",
      color: oklchToHex(background.light),
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: oklchToHex(background.dark),
    },
  ],
};
export const metadata: Metadata = {
  title: "Solid Suite",
  applicationName: "Solid Suite",
  appleWebApp: { capable: true, title: "Solid Suite", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const app = (
    <Providers environment={suiteEnv()}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {children}
    </Providers>
  );
  return (
    <html
      lang="en"
      className={`${onest.variable} ${sourceSerif.variable} ${sourceCode.variable}`}
      suppressHydrationWarning
      data-density="comfortable"
      data-theme="system"
    >
      <body>
        {process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? (
          // No provider (and so no session restore or pod-auth) runs before the startup check.
          <NativeStartupGate>{app}</NativeStartupGate>
        ) : (
          app
        )}
      </body>
    </html>
  );
}
