// AUTHORED-BY Codex GPT-6.1-Sol
import { onest, sourceCode, sourceSerif } from "@jeswr/suite-ui/fonts";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";
export const metadata: Metadata = { title: "Solid Suite · Component fixtures" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-density="comfortable" data-theme="system">
      <body className={`${onest.variable} ${sourceSerif.variable} ${sourceCode.variable}`}>
        <Providers>
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          {children}
        </Providers>
      </body>
    </html>
  );
}
