// AUTHORED-BY Codex GPT-6.1-Sol
import { tokens } from "@jeswr/suite-ui";
import { fixturesEnabled } from "../fixture-access";
export function GET() {
  if (!fixturesEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_DEV_FIXTURES))
    return new Response(null, { status: 404 });
  const primary = tokens.find((token) => token.name === "--primary");
  const surface = tokens.find((token) => token.name === "--surface-2");
  if (!primary || !surface) return new Response(null, { status: 500 });
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><style>svg{--ink:${primary.light};--paper:${surface.light}}@media(prefers-color-scheme:dark){svg{--ink:${primary.dark};--paper:${surface.dark}}}</style><path fill="var(--paper)" d="M0 0h640v400H0z"/><g fill="none" stroke="var(--ink)" stroke-width="4"><circle cx="320" cy="200" r="100"/><circle cx="320" cy="200" r="48"/><path d="m120 290 400-180M120 110l400 180"/></g></svg>`,
    { headers: { "content-type": "image/svg+xml" } },
  );
}
