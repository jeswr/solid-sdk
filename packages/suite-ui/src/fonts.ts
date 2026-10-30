// AUTHORED-BY Codex GPT-6.1-Sol
import localFont from "next/font/local";

export const onest = localFont({
  src: "./font-assets/onest/Onest-Variable.woff2",
  display: "swap",
  weight: "100 900",
  style: "normal",
  variable: "--font-onest",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
export const sourceSerif = localFont({
  src: "./font-assets/source-serif-4/SourceSerif4-Variable.woff2",
  display: "swap",
  weight: "200 900",
  style: "normal",
  adjustFontFallback: "Times New Roman",
  variable: "--font-source-serif",
  fallback: ["Georgia", "serif"],
});
export const sourceCode = localFont({
  src: [
    { path: "./font-assets/source-code-pro/SourceCodePro-Regular.woff2", weight: "400" },
    { path: "./font-assets/source-code-pro/SourceCodePro-Semibold.woff2", weight: "600" },
  ],
  display: "swap",
  style: "normal",
  variable: "--font-source-code",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
