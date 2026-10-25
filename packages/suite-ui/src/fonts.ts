// AUTHORED-BY Codex GPT-6.1-Sol
import { Onest, Source_Code_Pro, Source_Serif_4 } from "next/font/google";

export const onest = Onest({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: "variable",
  variable: "--font-onest",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
});
export const sourceSerif = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  axes: ["opsz"],
  variable: "--font-source-serif",
  fallback: ["Georgia", "serif"],
});
export const sourceCode = Source_Code_Pro({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["400", "600"],
  variable: "--font-source-code",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
