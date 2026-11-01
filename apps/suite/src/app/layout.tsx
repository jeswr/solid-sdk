// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { onest, sourceCode, sourceSerif } from "@jeswr/suite-ui/fonts";
import type { Metadata, Viewport } from "next";
import { NativeStartupGate } from "@/components/native-startup-gate";
import { Providers } from "./providers";
import "./globals.css";
export const viewport: Viewport = { colorScheme: "light dark" };
export const metadata: Metadata = { title: "Solid Suite · Component fixtures" };
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
        <Providers>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          {process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? (
            <NativeStartupGate>{children}</NativeStartupGate>
          ) : (
            children
          )}
        </Providers>
      </body>
    </html>
  );
}
