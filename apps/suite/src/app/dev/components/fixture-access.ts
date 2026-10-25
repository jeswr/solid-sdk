// AUTHORED-BY Codex GPT-6.1-Sol
export function fixturesEnabled(environment: string | undefined, flag: string | undefined) {
  return environment !== "production" || flag === "1";
}
