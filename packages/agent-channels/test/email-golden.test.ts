// AUTHORED-BY Codex GPT-6.1-Sol

// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createPublicKey, verify } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readdirSync, readFileSync } from "fs";
import { expect, it } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { createEmailRenderer } from "../src/email-mime/send.js";
import { inspectEmail } from "../src/email-mime.js";
import { AGENT_FOOTER, EMAIL_MIME } from "../src/profiles.js";
import type { RenderableProposal } from "../src/types.js";

it("matches the signed propose MIME golden and passes STRICT parity with the J2 default", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/propose.json", import.meta.url), "utf8"),
  );
  const proposal: RenderableProposal = { message: fixture.message, compactJws: fixture.compactJws };
  const publicKey = createPublicKey({ key: fixture.publicKey, format: "jwk" });
  const recipient = "receiver@example.test";
  const verifyMessage = async (compactJws: string) => {
    const [header, payload, signature] = compactJws.split(".") as [string, string, string];
    expect(header).toBe(Buffer.from('{"alg":"EdDSA"}').toString("base64url"));
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  };
  const renderer = createEmailRenderer({
    from: "sender@example.test",
    recipients: new Map([[fixture.message.to.actor, recipient]]),
    verify: verifyMessage,
    now: () => Date.parse("2026-10-26T12:00:00Z"),
  });
  const wire = await renderer.render(proposal, EMAIL_MIME);
  expect(wire.bytes).toBe(readFileSync(new URL("./fixtures/propose.eml", import.meta.url), "utf8"));
  const inspected = inspectEmail(wire.bytes, {
    parseEmail,
    recipient,
    ownAccounts: new Set([recipient]),
  });
  expect(inspected.parity).toBe("match");
  expect(inspected.proposal).toEqual(proposal);
  expect(inspected.message.textBody).toContain(AGENT_FOOTER);
  expect(inspected.message.signals["x-agentic-reply"]).toBe("1");
  expect(inspected.message.jsonLdBlocks).toHaveLength(2);
  expect(await renderer.validate(wire, proposal)).toEqual({ ok: true });
});

it("keeps footer URLs in a single config literal across channel source and tests", () => {
  const urls = AGENT_FOOTER.match(/https?:\/\/\S+/g) as string[];
  expect(urls).toHaveLength(2);
  const locations: string[] = [];
  for (const directory of ["../src/", "./"]) {
    const root = new URL(directory, import.meta.url);
    for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(new URL(file, root), "utf8");
      if (urls.some((url) => text.includes(url))) locations.push(`${directory}${file}`);
    }
  }
  // Checking the entire text is stronger than checking string literals alone.
  expect(locations).toEqual(["../src/profiles.ts"]);
});
