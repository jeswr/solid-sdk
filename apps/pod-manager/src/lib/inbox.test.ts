// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { inboxFor } from "./inbox.js";

const webId = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.8.8/inbox/";
function profile(target = inbox) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (url) =>
        new Response(
          String(url).endsWith("/profile")
            ? `<${webId}> <http://www.w3.org/ns/ldp#inbox> <${target}>.`
            : `<${inbox}> <http://www.w3.org/ns/ldp#contains> <${inbox}n>.`,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
}

test("binds the shared inbox manager to the active storage, refusing foreign and sibling pods", async () => {
  const opts = { webId, activeStorage: "https://8.8.8.8/" };
  expect((await inboxFor({ ...opts, fetchImpl: profile() }))?.inboxUrl).toBe(inbox);
  expect(await inboxFor({ ...opts, fetchImpl: profile("https://8.8.4.4/inbox/") })).toBeUndefined();
  expect(
    await inboxFor({ ...opts, activeStorage: "https://8.8.8.8/other/", fetchImpl: profile() }),
  ).toBeUndefined();
});

test("uses SDK scope guards for mark-read and dismiss before authenticated I/O", async () => {
  const fetchImpl = profile();
  const box = await inboxFor({ webId, activeStorage: "https://8.8.8.8/", fetchImpl });
  expect.assert(box);
  await expect(box.markRead("https://8.8.4.4/outside")).rejects.toThrow();
  await expect(box.dismiss(`${inbox}nested/n`)).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
