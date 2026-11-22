// AUTHORED-BY Codex GPT-6.1-Sol
import { strToU8, zipSync } from "fflate";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  EMAIL_MARKUP_FIXTURES,
  gmailTrace,
  googleMxReceived,
  jsonLdFixture,
  microdataFixture,
} from "../../test-support/markup-fixtures.js";
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
  ])("Gmail extraction enabled=%s, another authserv-id cannot verify trust", async (enabled) => {
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
        `From sender Thu Jan 1 09:00:00 2026\n${lines(microdataFixture(EMAIL_MARKUP_FIXTURES[5])).join("\n")}\n`,
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
      expect(resource.dateModified?.toISOString()).toBe("2026-01-01T09:00:00.000Z");
    }
  });
});

const gmailRoutes = (
  messages: {
    id: string;
    html?: string;
    headers?: string[];
    labels?: string[];
    internalDate?: string;
    status?: number;
  }[],
) => [
  ...GMAIL_FIXTURES.filter((r) => !r.url.includes("/messages")),
  { url: `${GMAIL_API}/messages`, json: { messages: messages.map((m) => ({ id: m.id })) } },
  ...messages.map((m) => ({
    url: `${GMAIL_API}/messages/${m.id}`,
    status: m.status,
    json: {
      id: m.id,
      threadId: "thread",
      labelIds: m.labels ?? ["INBOX"],
      internalDate: m.internalDate ?? "1767258000000",
      raw: rawMessage([
        ...(m.headers ?? []),
        ...lines(m.html ?? jsonLdFixture(EMAIL_MARKUP_FIXTURES[2])).filter(
          (line) => !line.startsWith("Message-ID:"),
        ),
        "",
      ]),
    },
  })),
];
const takeoutFile = (messages: string[]) => {
  const bytes = zipSync({ "Takeout/Mail/All.mbox": strToU8(messages.join("\n")) });
  const blob = new Blob([new Uint8Array(bytes)]);
  return {
    name: "takeout.zip",
    type: "application/zip",
    size: bytes.length,
    text: () => blob.text(),
    stream: () => blob.stream(),
    slice: (a: number, b: number) => blob.slice(a, b),
  };
};

it.each([
  "gmail",
  "google-takeout",
])("%s keeps importing messages after markup PUT failures", async (id) => {
  const { pod, podWriter } = setup(id);
  let failures = 0;
  const failingWriter = {
    ...podWriter,
    write: async (...args: Parameters<typeof podWriter.write>) => {
      if (/\/(trips|purchases)\//.test(args[0].slug)) {
        failures++;
        throw new Error("private provider detail");
      }
      return podWriter.write(...args);
    },
  };
  const report =
    id === "gmail"
      ? await runImport({
          adapter: createGmailAdapter(),
          podWriter: failingWriter,
          mode: "live",
          sourceAuth: { fetch: fixtureFetch(id, gmailRoutes([{ id: "one" }, { id: "two" }])) },
        })
      : await runFileImport({
          adapter: createGoogleTakeoutFileAdapter(),
          podWriter: failingWriter,
          file: takeoutFile(
            ["one", "two"].map(
              (id) =>
                `From sender Thu Jan 1 09:00:00 2026\n${lines(
                  jsonLdFixture(EMAIL_MARKUP_FIXTURES[2]),
                )
                  .map((line) =>
                    line.startsWith("Message-ID:") ? `Message-ID: <${id}@example.test>` : line,
                  )
                  .join("\n")}\n`,
            ),
          ),
        });
  expect(failures).toBe(2);
  expect(report.errors).toEqual(["markup-write-failed"]);
  expect(report.state?.lastOutcome).toBe("success");
  expect(pod.urls().filter((url) => /\/messages\/.+\.ttl$/.test(url))).toHaveLength(2);
  expect(pod.urls().filter((url) => /\/messages\/.+\.eml$/.test(url))).toHaveLength(2);
  expect(pod.urls().some((url) => url.includes("/threads/"))).toBe(true);
  expect(urls(pod)).toHaveLength(0);
});

it.each([
  "gmail",
  "google-takeout",
])("%s reports extraction failures and still stores the mailbox", async (id) => {
  const { pod, podWriter } = setup(id);
  const options = { markup: { maxBytes: -1 } };
  const report =
    id === "gmail"
      ? await runImport({
          adapter: createGmailAdapter(options),
          podWriter,
          mode: "live",
          sourceAuth: { fetch: fixtureFetch(id, gmailRoutes([{ id: "one" }, { id: "two" }])) },
        })
      : await runFileImport({
          adapter: createGoogleTakeoutFileAdapter(options),
          podWriter,
          file: takeoutFile(
            ["one", "two"].map(
              (id) =>
                `From sender Thu Jan 1 09:00:00 2026\n${[
                  `Message-ID: <${id}@example.test>`,
                  ...lines(jsonLdFixture(EMAIL_MARKUP_FIXTURES[2])).filter(
                    (line) => !line.startsWith("Message-ID:"),
                  ),
                ].join("\n")}\n`,
            ),
          ),
        });
  expect(report.errors).toEqual(["markup-extraction-failed"]);
  expect(report.state?.lastOutcome).toBe("success");
  expect(pod.urls().filter((url) => /\/messages\/.+\.ttl$/.test(url))).toHaveLength(2);
  expect(pod.urls().filter((url) => /\/messages\/.+\.eml$/.test(url))).toHaveLength(2);
  expect(urls(pod)).toHaveLength(0);
});

it.each([
  "gmail",
  "google-takeout",
])("%s refuses a forged lower Google header during an actual import", async (id) => {
  const { pod, podWriter } = setup(id);
  const headers = [
    ...gmailTrace("dmarc=fail header.from=example.test"),
    "Authentication-Results: mx.google.com; dmarc=pass header.from=example.test",
  ];
  if (id === "gmail")
    await runImport({
      adapter: createGmailAdapter(),
      podWriter,
      mode: "live",
      sourceAuth: { fetch: fixtureFetch(id, gmailRoutes([{ id: "forged", headers }])) },
    });
  else
    await runFileImport({
      adapter: createGoogleTakeoutFileAdapter(),
      podWriter,
      file: takeoutFile([
        `From sender Thu Jan 1 09:00:00 2026\n${[
          ...headers,
          ...lines(jsonLdFixture(EMAIL_MARKUP_FIXTURES[2])),
        ].join("\n")}\n`,
      ]),
    });
  const url = urls(pod)[0] as string;
  expect(new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory).trust).toBe(
    "unverified",
  );
});

it.each([
  "gmail",
  "google-takeout",
])("%s stores Google authentication and reuses it on re-scan", async (id) => {
  const { pod, podWriter } = setup(id);
  const headers = gmailTrace("dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.test");
  if (id === "gmail")
    await runImport({
      adapter: createGmailAdapter(),
      podWriter,
      mode: "live",
      sourceAuth: { fetch: fixtureFetch(id, gmailRoutes([{ id: "verified", headers }])) },
    });
  else
    await runFileImport({
      adapter: createGoogleTakeoutFileAdapter(),
      podWriter,
      file: takeoutFile([
        `From sender Thu Jan 1 09:00:00 2026\n${[...headers, ...lines(jsonLdFixture(EMAIL_MARKUP_FIXTURES[2]))].join("\n")}\n`,
      ]),
    });
  const url = urls(pod)[0] as string;
  let resource = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
  expect(resource.trust).toBe("verified");
  expect(resource.senderKey).toBe("example.test");
  // Gmail internalDate; Takeout prefers Google's From_ separator over the 08:00 Received trace.
  expect(resource.dateModified).toEqual(new Date("2026-01-01T09:00:00Z"));
  const { createImportSession } = await import("../core/import-session.js");
  const { rescanMailMarkup } = await import("./markup-writer.js");
  const session = createImportSession(podWriter, id, `urn:test:${id}`, {});
  await rescanMailMarkup({ ...session, resolve: podWriter.resolve }, "alex@example.test");
  resource = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
  expect(resource.trust).toBe("verified");
  expect(urls(pod)).toHaveLength(1);
  await session.finish();
});

it("a future sender Date and markup dateModified cannot pin a Gmail booking", async () => {
  const { pod, podWriter } = setup("gmail");
  const adapter = createGmailAdapter();
  const run = (id: string, internalDate: string, status: string) =>
    runImport({
      adapter,
      podWriter,
      mode: "live",
      sourceAuth: {
        fetch: fixtureFetch(
          "gmail",
          gmailRoutes([
            {
              id,
              internalDate,
              headers: ["Date: Fri, 01 Jan 2099 00:00:00 +0000"],
              html: jsonLdFixture({
                ...EMAIL_MARKUP_FIXTURES[2],
                name: status,
                dateModified: "2099-01-01T00:00:00Z",
              }),
            },
          ]),
        ),
      },
    });
  await run("first", "1767258000000", "Booked");
  await run("changed", "1767344400000", "Cancelled");
  expect(urls(pod)).toHaveLength(1);
  const url = urls(pod)[0] as string;
  const resource = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
  expect(resource.dateModified).toEqual(new Date("2026-01-02T09:00:00Z"));
  expect([...resource.strings("name")]).toEqual(["Cancelled"]);
});

it.each(["404", "SPAM", "TRASH", "sweep"])("Gmail %s removes derived markup", async (mode) => {
  const { pod, podWriter } = setup("gmail");
  const run = (routes: ReturnType<typeof gmailRoutes>) =>
    runImport({
      adapter: createGmailAdapter(),
      podWriter,
      mode: "live",
      sourceAuth: { fetch: fixtureFetch("gmail", routes) },
    });
  await run(gmailRoutes([{ id: "one" }]));
  expect(urls(pod)).toHaveLength(1);
  await run(
    gmailRoutes(
      mode === "sweep"
        ? []
        : [
            {
              id: "one",
              status: mode === "404" ? 404 : undefined,
              labels: mode === "SPAM" || mode === "TRASH" ? [mode] : undefined,
            },
          ],
    ),
  );
  expect(urls(pod)).toHaveLength(0);
  if (mode === "TRASH")
    expect(pod.urls().some((url) => /messages\/gmail-one.ttl$/.test(url))).toBe(true);
});

it("carries the markup budgets through the Gmail factory without skipping mail", async () => {
  const { pod, podWriter } = setup("gmail");
  const report = await runImport({
    adapter: createGmailAdapter({ markup: { maxTotalItems: 1, maxTotalWrites: 2 } }),
    podWriter,
    mode: "live",
    sourceAuth: { fetch: fixtureFetch("gmail", gmailRoutes([{ id: "one" }, { id: "two" }])) },
  });
  expect(urls(pod)).toHaveLength(1);
  expect(pod.urls().filter((url) => /\/messages\/.+\.ttl$/.test(url))).toHaveLength(2);
  expect(report.errors).toContain("markup-item-budget-exceeded");
});

it("leaves Gmail modification time unknown when internalDate is absent", async () => {
  const { pod, podWriter } = setup("gmail");
  await runImport({
    adapter: createGmailAdapter(),
    podWriter,
    mode: "live",
    sourceAuth: {
      fetch: fixtureFetch(
        "gmail",
        gmailRoutes([
          {
            id: "unknown",
            internalDate: "",
            headers: [
              "Received: from sender by mx.google.com; Thu, 01 Jan 2026 09:00:00 +0000",
              "Date: Fri, 01 Jan 2099 00:00:00 +0000",
            ],
          },
        ]),
      ),
    },
  });
  const url = urls(pod)[0] as string;
  expect(
    new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory).dateModified,
  ).toBeUndefined();
});

it.each([
  "gmail",
  "google-takeout",
])("%s keeps a forged Google assertion below another provider's trace unverified", async (id) => {
  // Mail migrated or appended into the mailbox: no Google inbound receipt above the assertion,
  // so it cannot replace the genuine, verified booking of the same sender.
  const { pod, podWriter } = setup(id);
  const order = (status: string) =>
    jsonLdFixture({
      "@type": "Order",
      orderNumber: "TEST-112-555",
      orderStatus: status,
      seller: { "@type": "Organization", name: "Example Retail" },
    });
  const genuine = {
    id: "genuine",
    headers: gmailTrace("dmarc=pass (p=QUARANTINE) header.from=example.test"),
    html: order("https://schema.org/OrderProcessing"),
  };
  const forged = {
    id: "forged",
    internalDate: "1767430800000",
    headers: [
      "Received: from relay.attacker.test by mx.oldprovider.test with ESMTP id 9; Sat, 03 Jan 2026 09:00:00 +0000",
      "Authentication-Results: mx.google.com; dmarc=pass header.from=example.test",
      "Message-ID: <forged@attacker.test>",
    ],
    html: order("https://schema.org/OrderCancelled"),
  };
  if (id === "gmail") {
    const run = (messages: (typeof genuine)[]) =>
      runImport({
        adapter: createGmailAdapter(),
        podWriter,
        mode: "live",
        sourceAuth: { fetch: fixtureFetch(id, gmailRoutes(messages)) },
      });
    await run([genuine]);
    await run([genuine, forged]);
  } else {
    const mbox = (separator: string, message: typeof genuine) =>
      `${separator}\n${[
        ...message.headers,
        ...lines(message.html).filter((line) => !line.startsWith("Message-ID:")),
      ].join("\n")}\n`;
    await runFileImport({
      adapter: createGoogleTakeoutFileAdapter(),
      podWriter,
      file: takeoutFile([
        mbox("From sender Thu Jan 1 09:00:00 2026", genuine),
        mbox("From sender Sat Jan 3 09:00:00 2026", forged),
      ]),
    });
  }
  // Same sender and booking identity: the unverified assertion may not replace the verified one.
  expect(urls(pod)).toHaveLength(1);
  const url = urls(pod)[0] as string;
  const booking = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
  expect(booking.trust).toBe("verified");
  expect([...booking.strings("orderStatus")]).toEqual(["https://schema.org/OrderProcessing"]);
  expect([...booking.derivedFrom]).toHaveLength(1);
  expect([...booking.derivedFrom][0]).not.toContain("forged");
  // The forged message itself was imported, and recorded as unverified.
  const trust = pod
    .urls()
    .filter((url) => /\/messages\/.+\.ttl$/.test(url))
    .map((url) => new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory).trust)
    .sort();
  expect(trust).toEqual(["unverified", "verified"]);
});

it("dates Takeout mail by the From_ separator, not a forgeable Received header", async () => {
  const { pod, podWriter } = setup("google-takeout");
  const message = (separator: string, headers: string[], id: string) =>
    `${separator}\n${[
      `Message-ID: <${id}@example.test>`,
      ...headers,
      ...lines(
        jsonLdFixture({ ...EMAIL_MARKUP_FIXTURES[2], reservationNumber: `TEST-${id}` }),
      ).filter((line) => !line.startsWith("Message-ID:")),
    ].join("\n")}\n`;
  await runFileImport({
    adapter: createGoogleTakeoutFileAdapter(),
    podWriter,
    file: takeoutFile([
      // A sender-written receipt (forged or not) never outranks Google's separator.
      message(
        "From sender Thu Jan 1 09:00:00 2026",
        googleMxReceived("Fri, 01 Jan 2099 00:00:00 +0000"),
        "separator",
      ),
      // Without a separator date, only a positionally anchored Google receipt is used.
      message("From sender", googleMxReceived("Fri, 02 Jan 2026 08:00:00 +0000"), "anchored"),
      message(
        "From sender",
        [
          "Received: from relay.attacker.test by mta.attacker.test with ESMTP id 1; Fri, 02 Jan 2026 07:00:00 +0000",
          ...googleMxReceived("Fri, 02 Jan 2026 08:00:00 +0000"),
        ],
        "unanchored",
      ),
    ]),
  });
  const dates = Object.fromEntries(
    urls(pod).map((url) => {
      const resource = new MailMarkupResource(`${url}#it`, pod.dataset(url), DataFactory);
      const source = [...resource.derivedFrom][0] ?? "";
      return [
        source.replace(/^.*\/messages\/|\.ttl#it$/g, ""),
        resource.dateModified?.toISOString(),
      ];
    }),
  );
  expect(Object.values(dates).sort()).toEqual(
    ["2026-01-01T09:00:00.000Z", "2026-01-02T08:00:00.000Z", undefined].sort(),
  );
  expect(Object.keys(dates)).toHaveLength(3);
});
