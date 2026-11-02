// AUTHORED-BY Codex GPT-6.1-Sol
import { onest, sourceCode, sourceSerif } from "@jeswr/suite-ui/fonts";
import type { Metadata, Viewport } from "next";
import { suiteEnv } from "@/shell/lib/env";
import { Providers } from "./providers";
import "./globals.css";
export const viewport: Viewport = { colorScheme: "light dark" };
export const metadata: Metadata = { title: "Solid Suite", icons: { icon: "/icon.svg" } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${sourceSerif.variable} ${sourceCode.variable}`}
      suppressHydrationWarning
      data-density="comfortable"
      data-theme="system"
    >
      <body>
        <Providers environment={suiteEnv()}>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
