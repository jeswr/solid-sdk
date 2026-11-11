// AUTHORED-BY Codex GPT-6.1-Sol
import { strToU8, zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { runFileImport } from "../core/file-import.js";
import { runImport } from "../core/import-runner.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import {
  createMemoryPod,
  fixtureFetch,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "../core/testing.js";
import { createGmailAdapter } from "../gmail/adapter.js";
import { GMAIL_API, GMAIL_FIXTURES, rawMessage } from "../gmail/fixtures.js";
import { createGoogleTakeoutFileAdapter } from "../google-takeout/file-adapter.js";
import { EMAIL_MARKUP_FIXTURES, jsonLdFixture, microdataFixture } from "./markup-fixtures.js";
import { MailMarkupResource } from "./markup-vocab.js";

const lines = (html: string) => [
  "Delivered-To: alex@example.test",
  "Message-ID: <markup@example.test>",
  "From: receipts@example.test",
  "To: alex@example.test",
  "Subject: Your synthetic reservation",
  "Date: Tue, 01 Dec 2026 09:00:00 +0000",
  "Authentication-Results: fake.example.test; dmarc=pass; spf=pass; dkim=pass",
  "MIME-Version: 1.0",
  'Content-Type: text/html; charset="UTF-8"',
  "",
  html,
];
const urls = (pod: ReturnType<typeof createMemoryPod>) =>
  pod.urls().filter((url) => /\/(trips|purchases)\/.+\.ttl$/.test(url));
function setup(id: string) {
  const pod = createMemoryPod();
  const podWriter = createFetchPodWriter({
    adapterId: id,
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch: pod.fetch,
  });
  return { pod, podWriter };
}
describe("transactional markup import hooks", () => {
  it.each([
    true,
    false,
  ])("Gmail extraction enabled=%s, raw authentication headers never verify trust", async (enabled) => {
    const { pod, podWriter } = setup("gmail");
    const adapter = createGmailAdapter({ extractMarkup: enabled });
    const routes = [
      ...GMAIL_FIXTURES.filter((r) => !r.url.includes("/messages")),
      { url: `${GMAIL_API}/messages`, json: { messages: [{ id: "markup" }] } },
      {
        url: `${GMAIL_API}/messages/markup`,
        json: {
          id: "markup",
          threadId: "thread",
          labelIds: ["INBOX"],
          internalDate: "1796115600000",
          raw: rawMessage(lines(jsonLdFixture(EMAIL_MARKUP_FIXTURES[2]))),
        },
      },
    ];
    const run = () =>
      runImport({
        adapter,
        podWriter,
        mode: "live",
        sourceAuth: { fetch: fixtureFetch("gmail", routes) },
      });
    await run();
    await run();
    expect(urls(pod)).toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      const iri = `${urls(pod)[0]}#it`;
      const resource = new MailMarkupResource(
        iri,
        pod.dataset(urls(pod)[0] as string),
        DataFactory,
      );
      expect(resource.trust).toBe("unverified");
      expect([...resource.derivedFrom]).toEqual([
        `${TEST_POD_ROOT}integrations/gmail/mail/alex~40example.test/messages/gmail-markup.ttl#it`,
      ]);
    }
  });
  it.each([true, false])("Takeout mbox extraction enabled=%s with microdata", async (enabled) => {
    const { pod, podWriter } = setup("google-takeout");
    const bytes = zipSync({
      "Takeout/Mail/All.mbox": strToU8(
        `From sender Tue Dec 1 09:00:00 2026\n${lines(microdataFixture(EMAIL_MARKUP_FIXTURES[5])).join("\n")}\n`,
      ),
    });
    const blob = new Blob([new Uint8Array(bytes)]);
    const file = {
      name: "takeout.zip",
      type: "application/zip",
      size: bytes.length,
      text: () => blob.text(),
      stream: () => blob.stream(),
      slice: (start: number, end: number) => blob.slice(start, end),
    };
    const adapter = createGoogleTakeoutFileAdapter({ extractMarkup: enabled });
    const run = () => runFileImport({ adapter, file, podWriter });
    await run();
    await run();
    expect(urls(pod)).toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      const url = urls(pod)[0] as string;
      const resource = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
      expect(resource.trust).toBe("unverified");
      expect([...resource.derivedFrom][0]).toContain("/messages/");
      expect(resource.dateModified?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    }
  });
});
