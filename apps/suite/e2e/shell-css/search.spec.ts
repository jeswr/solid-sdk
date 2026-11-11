// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Writer } from "n3";
import { encodeRef } from "../../src/lib/refs";
import {
  accessible,
  accountAuth,
  cssAccount,
  expect,
  signedOutTest,
  signIn,
  tabTo,
  warmLiveRoutes,
} from "./fixtures";

function turtle(write: (writer: Writer) => void) {
  const writer = new Writer();
  write(writer);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

interface SearchPod {
  query: string;
  files: { name: string; body: string; href: string }[];
  document: { title: string; href: string };
  task: { title: string; href: string };
}

const test = signedOutTest.extend<{ searchPod: SearchPod }>({
  searchPod: async ({ request }, use) => {
    const account = cssAccount("alice");
    const auth = await accountAuth("alice");
    // The folder name deliberately differs from the query, so only seeded items match.
    const root = new URL(`alice/shell-search-${randomUUID()}/`, account.issuer).href;
    const query = `sh11-${randomUUID()}`;
    const put = async (url: string, body: string, contentType: string) => {
      const response = await auth.fetch(url, {
        method: "PUT",
        headers: { "Content-Type": contentType, "If-None-Match": "*" },
        body,
      });
      expect(response.status).toBe(201);
    };
    const { namedNode, literal } = DataFactory;
    try {
      await put(root, await turtle(() => {}), "text/turtle");
      const aclUrl = new URL(".acl", root).href;
      const acl = "http://www.w3.org/ns/auth/acl#";
      const owner = namedNode(`${aclUrl}#owner`);
      await put(
        aclUrl,
        await turtle((writer) => {
          writer.addQuad(owner, namedNode(`${NS.RDF}type`), namedNode(`${acl}Authorization`));
          writer.addQuad(owner, namedNode(`${acl}agent`), namedNode(account.webId));
          writer.addQuad(owner, namedNode(`${acl}accessTo`), namedNode(root));
          writer.addQuad(owner, namedNode(`${acl}default`), namedNode(root));
          for (const mode of ["Read", "Write", "Control"])
            writer.addQuad(owner, namedNode(`${acl}mode`), namedNode(`${acl}${mode}`));
        }),
        "text/turtle",
      );
      const files: SearchPod["files"] = [];
      for (const suffix of ["alpha", "beta"]) {
        const name = `${query}-${suffix}.txt`;
        const url = new URL(name, root).href;
        const body = `Alice's real CSS search result: ${query} ${suffix}.`;
        await put(url, body, "text/plain");
        files.push({ name, body, href: `/drive/p/${encodeRef(url)}` });
      }
      const documentUrl = new URL("document.ttl", root).href;
      const taskUrl = new URL("task.ttl", root).href;
      const document = { title: `${query} document`, href: `/docs/d/${encodeRef(documentUrl)}` };
      const task = {
        title: `${query} task`,
        href: `/tasks/inbox?task=${encodeRef(`${taskUrl}#it`)}`,
      };
      for (const [url, type, title] of [
        [documentUrl, `${NS.SCHEMA}DigitalDocument`, document.title],
        [taskUrl, `${NS.WF}Task`, task.title],
      ] as const) {
        await put(
          url,
          await turtle((writer) => {
            const subject = namedNode(`${url}#it`);
            writer.addQuad(subject, namedNode(`${NS.RDF}type`), namedNode(type));
            writer.addQuad(subject, namedNode("http://purl.org/dc/terms/title"), literal(title));
          }),
          "text/turtle",
        );
      }
      // A visible preview must prove the browser's authenticated read, not public access.
      const anonymous = await request.get(new URL(`${query}-alpha.txt`, root).href);
      expect([401, 403]).toContain(anonymous.status());
      await anonymous.dispose();
      // Seed before sign-in: the shell's bounded, idle-time warmer starts with the account.
      await use({ query, files, document, task });
    } finally {
      // This harness owns a fresh in-memory CSS per run. Keep uniquely named resources
      // until it stops: deleting them here races another project's Drive namespace checks.
      await auth.logout();
    }
  },
});

test.beforeAll(async ({ request }) => {
  await warmLiveRoutes(request);
  expect((await request.get("/search?scope=drive")).status()).toBe(200);
});

for (const keyboardOnly of [false, true]) {
  test(`scenario 6: real-pod grouped search, scope and Enter${keyboardOnly ? " using only the keyboard" : ""}`, async ({
    page,
    searchPod,
  }) => {
    await signIn(page, "alice", { keyboardOnly });
    // Drive's own page supplies an app-specific searchbox. The shell's search route
    // exposes GlobalSearch with the same real Drive scope, including on small screens.
    await page.goto("/search?scope=drive");
    await page.getByRole("heading", { level: 1, name: "Search", exact: true }).waitFor();

    if (keyboardOnly) await page.keyboard.press("/");
    else if ((page.viewportSize()?.width ?? 1280) < 768)
      await page.getByRole("button", { name: "Search", exact: true }).click();
    const input = page.getByRole("combobox", { name: "Search", exact: true });
    if (keyboardOnly) {
      await expect(input).toBeFocused();
      await page.keyboard.type(searchPod.query);
    } else await input.fill(searchPod.query);

    const results = page.getByRole("listbox", { name: "Search results", exact: true });
    const files = results.getByRole("group", { name: "Files", exact: true });
    // Warming is asynchronous and triggers a new visible query when complete; never sleep.
    for (const file of searchPod.files)
      await expect(files.getByRole("option").filter({ hasText: file.name })).toBeVisible({
        timeout: 30_000,
      });
    await expect(files.getByRole("option")).toHaveCount(2);
    await expect(results.getByRole("group", { name: "Documents", exact: true })).toHaveCount(0);
    await expect(results.getByRole("group", { name: "Tasks", exact: true })).toHaveCount(0);
    const scoped = page.getByRole("button", { name: "in Drive, remove scope", exact: true });
    await expect(scoped).toBeVisible();
    await expect(page.getByText("Searching your saved copies", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Your storage doesn't offer search, so results come from items you've opened or synced.",
        { exact: true },
      ),
    ).toBeVisible();
    await accessible(page);

    const toggleScope = async (target: typeof scoped) => {
      if (keyboardOnly) {
        await tabTo(page, target);
        await page.keyboard.press("Enter");
      } else await target.click();
      await expect(input).toBeFocused();
    };
    await toggleScope(scoped);
    const everywhere = page.getByRole("button", {
      name: "Everywhere, search only in Drive",
      exact: true,
    });
    await expect(everywhere).toHaveText("Everywhere");
    const documents = results.getByRole("group", { name: "Documents", exact: true });
    const tasks = results.getByRole("group", { name: "Tasks", exact: true });
    await expect(documents.getByRole("option")).toContainText([searchPod.document.title], {
      timeout: 30_000,
    });
    await expect(documents.getByRole("option")).toHaveAttribute("href", searchPod.document.href);
    await expect(tasks.getByRole("option")).toContainText([searchPod.task.title], {
      timeout: 30_000,
    });
    await expect(tasks.getByRole("option")).toHaveAttribute("href", searchPod.task.href);
    await expect(files.getByRole("option")).toHaveCount(2);
    await accessible(page);

    await toggleScope(everywhere);
    await expect(scoped).toBeVisible();
    await expect(documents).toHaveCount(0);
    await expect(tasks).toHaveCount(0);
    await expect(files.getByRole("option")).toHaveCount(2);
    const first = files.getByRole("option").first();
    const href = await first.getAttribute("href");
    const opened = searchPod.files.find((file) => file.href === href);
    expect(opened).toBeDefined();
    if (!opened) throw new Error("Search result did not link to a seeded file");
    await page.keyboard.press("ArrowDown");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      (await first.getAttribute("id")) ?? "",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(opened.href);
    await expect(page.getByRole("listbox", { name: "Search results", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "File preview", exact: true })).toContainText(
      opened.body,
    );
    await accessible(page);
  });
}
