// AUTHORED-BY Codex GPT-6.1-Sol
import type { guardedFetch } from "@jeswr/guarded-fetch";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { vi } from "vitest";

export const raw = readFileSync(new URL("propose.eml", import.meta.url), "utf8");
export const recipient = "receiver@example.test";
export const mime = (text = raw): Response =>
  new Response(text, { headers: { "content-type": "message/rfc822" } });
export function fixtureTransport(replies: unknown[]) {
  const requests: Array<{ url: URL; headers: Headers; body: string; method: string | undefined }> =
    [];
  const queue = [...replies];
  const transport = vi.fn<typeof guardedFetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? await new Response(init.body).text() : "";
    requests.push({ url, headers, body, method: init?.method });
    if (!queue.length) throw new Error("fixture exhausted");
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  return {
    requests,
    queue,
    options: {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
  };
}
