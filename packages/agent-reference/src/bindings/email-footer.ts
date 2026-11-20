// AUTHORED-BY Codex GPT-6.2 Sol
import type { AnyMessage } from "../core/types.js";
import { conformanceClaimSchema } from "../profile/description.js";

export type FooterVariant = "neutral" | "named";
export const FOOTER_LINK = "https://answerableagents.org/#/start";

type Names = { agent: string; principal: string };

/** Named wording requires the sender's own conformance claim in this signed message. */
export function footerVariant(message: AnyMessage): FooterVariant {
  if (message.kind !== "description") return "neutral";
  const description = message.body.description;
  if (
    description.type !== "ImplementationDescription" ||
    !message.from.actor ||
    description.describes !== message.from.actor ||
    !Array.isArray(description.conformance)
  )
    return "neutral";
  return description.conformance.some((claim) => conformanceClaimSchema.safeParse(claim).success)
    ? "named"
    : "neutral";
}

function displayName(name: string): string {
  return Array.from(name.replace(/[\p{Cc}\u2028\u2029]/gu, " "))
    .slice(0, 120)
    .join("");
}

function footerLines({ agent, principal, variant }: Names & { variant: FooterVariant }): string[] {
  return [
    `Sent by ${displayName(agent)}, an automated assistant acting for ${displayName(principal)}.`,
    ...(variant === "named"
      ? [
          "It is an Answerable agent: this message is signed, says what the agent is allowed to do, and is recorded.",
          "You can reply as normal. If you use an agent of your own, it can check all of this for you.",
          "Get one that is Answerable too:",
        ]
      : [
          "I use an agent that supports signed messages: a signed copy of this message is attached.",
          "You can reply as normal. If you use an agent of your own, it can check the signed copy for you.",
          "What this means, and how to get such an agent:",
        ]),
  ];
}

export function footerText(input: Names & { variant: FooterVariant }): string {
  return `${footerLines(input).join("\n")} ${FOOTER_LINK}`;
}

export function footerHtml(input: Names & { variant: FooterVariant }): string {
  const text = footerLines(input)
    .join(" ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<p>${text} <a href="${FOOTER_LINK}">${FOOTER_LINK}</a></p>`;
}

export function splitFooter(
  readable: string,
  names: Names,
): { body: string; variant: FooterVariant | "none" } {
  for (const variant of ["neutral", "named"] as const) {
    const suffix = `\n\n${footerText({ ...names, variant })}`;
    if (readable.endsWith(suffix)) return { body: readable.slice(0, -suffix.length), variant };
  }
  return { body: readable, variant: "none" };
}
