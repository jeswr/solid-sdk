import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { NO_FLASH_THEME_SCRIPT } from "@/lib/theme-script";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Solid app",
  description: "A Solid app — login, profile read, pod data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* No-flash theme: set the `.dark` class BEFORE first paint from the
            persisted preference / OS setting, so a dark-mode reload never flashes
            light. The script body is a trusted, static string (no user input).
            Kept in lib/theme-script.ts so this SERVER component does not import
            from the @jeswr/app-shell barrel (which evaluates client-only
            React.createContext and breaks RSC page-data collection). It uses the
            SAME storageKey + attributeClass as the <ThemeProvider>. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
