// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { envelopeBytes } from "../src/bindings/bytes.js";
import { FOOTER_LINK, footerHtml, footerText, splitFooter } from "../src/bindings/email-footer.js";
import { readEmail, writeEmail } from "../src/bindings/email-mime.js";

const names = { agent: "Sam's agent", principal: "Sam" };

it("renders the exact four lines of both variants", () => {
  expect(footerText({ ...names, variant: "named" }).split("\n")).toEqual([
    "Sent by Sam's agent, an automated assistant acting for Sam.",
    "It is an Answerable agent: this message is signed, says what the agent is allowed to do, and is recorded.",
    "You can reply as normal. If you use an agent of your own, it can check all of this for you.",
    "Get one that is Answerable too: https://answerableagents.org/#/start",
  ]);
  expect(footerText({ ...names, variant: "neutral" }).split("\n")).toEqual([
    "Sent by Sam's agent, an automated assistant acting for Sam.",
    "I use an agent that supports signed messages: a signed copy of this message is attached.",
    "You can reply as normal. If you use an agent of your own, it can check the signed copy for you.",
    `What this means, and how to get such an agent: ${FOOTER_LINK}`,
  ]);
  const longName = "x".repeat(119);
  expect(
    footerText({
      agent: `Agent\r\n\t\u007f`,
      principal: `${longName}😀extra`,
      variant: "neutral",
    }).split("\n")[0],
  ).toBe(`Sent by Agent    , an automated assistant acting for ${longName}😀.`);
});

it("uses the same HTTPS link across recipients, messages and conversations", () => {
  const link = new URL(FOOTER_LINK);
  expect(link).toMatchObject({
    protocol: "https:",
    pathname: "/",
    search: "",
    username: "",
    password: "",
    hash: "#/start",
  });
  for (let i = 0; i < 20; i++) {
    const to = `recipient-${i}@fictional.example`;
    const messageId = `message-${i}@fictional.example`;
    const conversation = `urn:test:conversation:${i}`;
    const variant = i % 2 === 0 ? "neutral" : "named";
    const sender = { agent: `Agent ${i}`, principal: `Principal ${i}` };
    const body = `Message ${messageId} in ${conversation}`;
    const mime = writeEmail(
      { bytes: envelopeBytes({ messageId, conversation }), mediaType: "application/ld+json" },
      `${body}\n\n${footerText({ ...sender, variant })}`,
      "https://fictional.example/description",
      { to, messageId, from: "sender@fictional.example", date: "Fri, 13 Nov 2026 09:00:00 +0000" },
    );
    const { readable } = readEmail(mime);
    expect(readable.match(/https:\/\/\S+/g)?.map((url) => Buffer.from(url))).toEqual([
      Buffer.from(FOOTER_LINK),
    ]);
    expect(splitFooter(readable, sender)).toEqual({ body, variant });
  }
});

it("escapes names in HTML and keeps only the fixed anchor", () => {
  const html = footerHtml({
    agent: '<Agent & "Helper">',
    principal: '"Sam" & <friend>',
    variant: "neutral",
  });
  expect(html).toContain("&lt;Agent &amp; &quot;Helper&quot;&gt;");
  expect(html).toContain("&quot;Sam&quot; &amp; &lt;friend&gt;");
  expect(html.match(/<a\b[^>]*>[^<]*<\/a>/g)).toEqual([
    `<a href="${FOOTER_LINK}">${FOOTER_LINK}</a>`,
  ]);
  expect(html).not.toMatch(/<img|style|src=/i);
});

it("splits only an exact suffix for the signed sender", () => {
  const footer = footerText({ ...names, variant: "neutral" });
  const body = "Existing readable text";
  const mail = `${body}\n\n${footer}`;
  expect(splitFooter(mail, names)).toEqual({ body, variant: "neutral" });
  for (const readable of [
    mail.replace("as normal", "urgently"),
    mail.replace(FOOTER_LINK, `${FOOTER_LINK}?recipient=Sam`),
    `${body}\n\n${footerText({ ...names, principal: "Lee", variant: "neutral" })}`,
    `${mail}\n\nMore text`,
  ]) {
    expect(splitFooter(readable, names)).toEqual({ body: readable, variant: "none" });
  }
});
