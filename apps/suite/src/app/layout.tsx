// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { onest, sourceCode, sourceSerif } from "@jeswr/suite-ui/fonts";
import type { Metadata, Viewport } from "next";
import { NativeStartupGate } from "@/components/native-startup-gate";
import { SkipLink } from "@/shell/i18n";
import { suiteEnv } from "@/shell/lib/env";
import { Providers } from "./providers";
import "./globals.css";
export const viewport: Viewport = { colorScheme: "light dark" };
export const metadata: Metadata = { title: "Solid Suite", icons: { icon: "/icon.svg" } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const app = (
    <Providers environment={suiteEnv()}>
      <SkipLink />
      {children}
    </Providers>
  );
  return (
    <html
      lang="en"
      dir="ltr"
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
