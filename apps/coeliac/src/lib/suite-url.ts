// AUTHORED-BY Codex GPT-6
/** Shared destination for the retired entry point and the remaining app's navigation. */
export function suiteDiaryUrl(): string {
  const base = process.env.NEXT_PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app";
  return `${base.replace(/\/+$/, "")}/health/diary?mode=coeliac`;
}
