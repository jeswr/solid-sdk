// AUTHORED-BY Codex GPT-6.1-Sol
// Explicit disposable Postmill UI recording, never used as production-site knowledge.
import { randomUUID } from "node:crypto";
import type { Demonstration } from "@jeswr/site-profiler";

type Page = Parameters<Demonstration["run"]>[0];
export function forumFixture() {
  return {
    title: `SAB test post ${randomUUID().slice(0, 12)}`,
    body: "Disposable sandbox discussion body.",
    comment: `SAB comment ${randomUUID().slice(0, 12)}`,
    edited: "SAB edited disposable comment.",
    forum: "10001",
    forumName: "AskReddit",
    postUrl: "",
    commentUrl: "",
  };
}
export type ForumFixture = ReturnType<typeof forumFixture>;
export async function deleteOwnForumPost(page: Page, origin: string, item: ForumFixture) {
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!["GET", "HEAD"].includes(request.method())) {
      const id = item.postUrl.split("/")[5];
      const base = `/f/${item.forumName}/${id}/-/`;
      if (
        !id ||
        !(
          url.pathname === `${base}delete` ||
          (url.pathname.startsWith(`${base}comment/`) && url.pathname.endsWith("/delete_own"))
        )
      )
        return route.abort();
    }
    return route.fallback();
  });
  // Recover the redirect if a create succeeded just before the test failed.
  if (!item.postUrl) {
    await page.goto(`${origin}/search?q=${encodeURIComponent(item.title)}`);
    const own = page
      .locator("article.submission")
      .filter({ has: page.getByRole("link", { name: item.title, exact: true }) });
    if ((await own.count()) !== 1) return;
    item.postUrl = new URL(
      (await own.locator(".submission__nav a").first().getAttribute("href")) ?? "",
      origin,
    ).href;
  }
  await page.goto(item.postUrl);
  const post = page.locator("article.submission").first();
  if ((await post.count()) === 0) return;
  if (
    (await post
      .locator(".submission__title")
      .innerText()
      .catch(() => "")) !== item.title
  )
    return;
  if ((await post.locator(".submission__submitter").innerText()) !== "MarvelsGrantMan136")
    throw new Error("Cleanup refused: wrong author");
  for (const comment of await page.locator("article.comment").all()) {
    const body = await comment.locator(".comment__body").innerText();
    if (![item.comment, item.edited].includes(body.trim())) continue;
    if ((await comment.locator(".comment__info a").first().innerText()) !== "MarvelsGrantMan136")
      throw new Error("Cleanup refused: wrong comment author");
    page.once("dialog", (dialog) => dialog.accept());
    await Promise.all([
      page.waitForNavigation(),
      comment.locator('form[action$="/delete_own"] button').click(),
    ]);
  }
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([
    page.waitForNavigation(),
    post.locator('form[action$="/delete"] button').click(),
  ]);
}
export function forumDemonstration(origin: string, item: ForumFixture): Demonstration {
  return {
    name: "disposable-forum-cycle",
    async run(page) {
      // Only UI forms on our own created item may write. Background preferences are blocked.
      await page.route("**/*", async (route) => {
        const r = route.request(),
          url = new URL(r.url());
        // Record native HTML forms; block optional JS so votes use their visible form action.
        if (r.resourceType() === "script") return route.abort();
        if (url.origin !== origin) return route.abort();
        if (r.method() !== "GET" && r.method() !== "HEAD") {
          const id = item.postUrl.split("/")[5];
          const cid = item.commentUrl.split("/").at(-1);
          if (
            !(
              url.pathname === "/submit" ||
              (id &&
                (url.pathname.startsWith(`/f/${item.forumName}/${id}/`) ||
                  url.pathname === `/sv/${id}` ||
                  url.pathname === `/sv/${id}.json`)) ||
              (cid && url.pathname.includes(`/comment/${cid}/`))
            )
          )
            return route.abort();
        }
        return route.fallback();
      });
      try {
        await page.goto(`${origin}/f/${item.forumName}/10224`);
        await page.goto(`${origin}/f/${item.forumName}/new`);
        const next = await page.locator('a[rel="next"]').getAttribute("href");
        if (next) await page.goto(new URL(next, origin).href);
        await page.goto(`${origin}/f/${item.forumName}/top`);
        await page.goto(`${origin}/submit`);
        // Empty file controls are not a file upload. Omit the unused control from this text-only recording.
        await page.locator('input[type="file"]').evaluateAll((els) =>
          els.forEach((el) => {
            el.remove();
          }),
        );
        await page.locator('[name="submission[title]"]').fill(item.title);
        await page.locator('[name="submission[body]"]').fill(item.body);
        await page.locator('[name="submission[forum]"]').selectOption(item.forum);
        await Promise.all([
          page.waitForNavigation(),
          page
            .locator('form[name="submission"]')
            .locator("button:not([type]), button[type=submit]")
            .click(),
        ]);
        if (!page.url().includes("/f/")) throw new Error("Post creation failed");
        item.postUrl = page.url();
        await page.goto(item.postUrl.split("/").slice(0, 6).join("/"));
        await page.locator('textarea[name$="[comment]"]').fill(item.comment);
        await Promise.all([
          page.waitForNavigation(),
          page
            .locator('form[name^="reply_to_submission"]')
            .locator("button:not([type]), button[type=submit]")
            .click(),
        ]);
        const comment = page
          .locator("article.comment")
          .filter({ has: page.locator(".comment__body", { hasText: item.comment }) })
          .first();
        item.commentUrl = new URL(
          (await comment.locator("a.comment__permalink").getAttribute("href")) ?? "",
          origin,
        ).href;
        // Witness the item's own permalink as an executable verification read,
        // independent of the parent discussion and editor form.
        await page.goto(item.commentUrl);
        await comment.getByRole("link", { name: "Edit", exact: true }).click();
        await page.locator("textarea").fill(item.edited);
        await Promise.all([
          page.waitForNavigation(),
          page
            .locator("main form")
            .filter({ has: page.locator("textarea") })
            .locator("button:not([type]), button[type=submit]")
            .click(),
        ]);
        await page.goto(item.postUrl);
        await page.locator("form.vote [data-action]").evaluateAll((els) => {
          for (const el of els) el.removeAttribute("data-action");
        });
        // Creation automatically votes. Record both UI transitions; keep the learned effect conservative.
        const vote = page
          .locator("article.submission")
          .first()
          .locator('button[title="Retract upvote"]');
        if (await vote.count()) {
          await Promise.all([page.waitForNavigation(), vote.click()]);
        }
        await page.locator("form.vote [data-action]").evaluateAll((els) => {
          for (const el of els) el.removeAttribute("data-action");
        });
        await Promise.all([
          page.waitForNavigation(),
          page.locator('article.submission button[title="Upvote"]').click(),
        ]);
        const ownComment = page.locator("article.comment").first();
        page.once("dialog", (dialog) => dialog.accept());
        await Promise.all([
          page.waitForNavigation(),
          ownComment.locator('form[action$="/delete_own"] button').click(),
        ]);
        await deleteOwnForumPost(page, origin, item);
      } finally {
        await deleteOwnForumPost(page, origin, item);
      }
    },
  };
}
