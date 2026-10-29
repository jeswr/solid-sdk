// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Reddit → Social & interests. Saved posts (`/user/{name}/saved`) as
 * `schema:SocialMediaPosting` and subscribed subreddits
 * (`/subreddits/mine/subscriber`) as `foaf:Group`.
 *
 * Incremental: page newest-first until the previous saved fullname is seen;
 * newer saves are merged by the framework. Subreddits are
 * snapshot. Live mode works secretless via Reddit's installed-app convention
 * (Basic auth with an empty secret on the token exchange).
 */
import { DataFactory, Store } from "n3";
import { RunBudget, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { Pagination } from "../core/pagination.js";
import { arr, optionalDate, optionalText, SkipCounter } from "../core/safe.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES, Group, SocialMediaPosting } from "../core/vocab.js";
import {
  REDDIT_FIXTURES,
  type RedditListing,
  type RedditMe,
  type RedditSavedPost,
  type RedditSubreddit,
} from "./fixtures.js";
import { vocabMap } from "./vocab-map.js";

const ID = "reddit";
const API = "https://oauth.reddit.com";
const SCOPES = ["identity", "history", "mysubreddits"] as const;

/** Create an adapter with host-selected per-run source limits. */
export function createRedditAdapter(limits?: RunLimits): IntegrationAdapter {
  return {
    vocabMap,
    metadata: {
      id: ID,
      name: "Reddit",
      tier: "A",
      authKind: "oauth-pkce",
      scopes: SCOPES,
      categories: ["social"],
      whatYouGet: "Your saved posts and the communities you're part of, in Social & interests.",
      requirements: [
        'Create an "installed app" at reddit.com/prefs/apps.',
        "Set <app-origin>/oauth-callback.html as the redirect uri.",
        "Set NEXT_PUBLIC_REDDIT_CLIENT_ID — installed apps exchange the code with an empty secret, no proxy needed.",
      ],
    },
    oauth: {
      clientId: undefined,
      authorizationEndpoint: "https://www.reddit.com/api/v1/authorize",
      tokenEndpoint: "https://www.reddit.com/api/v1/access_token",
      scopes: SCOPES,
      tokenExchange: "public",
      basicAuthForToken: true,
      extraAuthParams: { duration: "permanent" },
    },
    fixtures: () => REDDIT_FIXTURES,

    async import(ctx: ImportContext): Promise<ImportOutcome> {
      const budget = new RunBudget(ID, limits);
      const skipped = new SkipCounter();
      ctx.progress({ label: "Checking who you are on Reddit…", done: 0, total: 3 });
      budget.request();
      const me = await getJson<RedditMe>(ID, ctx.api, `${API}/api/v1/me`, undefined, budget);
      budget.items(1);

      ctx.progress({ label: "Fetching your saved posts…", done: 1, total: 3 });
      const username = optionalText(me?.name);
      if (!username) throw new IntegrationSyncError(ID, "Reddit did not return your username.");
      const savedUrl = `${API}/user/${encodeURIComponent(username)}/saved?limit=100&raw_json=1`;
      const saved: RedditSavedPost[] = [];
      let newest: string | undefined;
      const pagination = new Pagination(ID);
      let after: string | undefined;
      let reachedCheckpoint = false;
      do {
        budget.request();
        const page = await getJson<RedditListing<RedditSavedPost>>(
          ID,
          ctx.api,
          `${savedUrl}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
          undefined,
          budget,
        );
        const children = arr(page?.data?.children);
        budget.items(children.length);
        for (const child of children) {
          const p = child?.data;
          if (!p || !optionalText(p.id) || !optionalText(p.name)) {
            skipped.skip();
            continue;
          }
          newest ??= p.name;
          if (p.name === ctx.cursor) {
            reachedCheckpoint = true;
            break;
          }
          saved.push(child);
        }
        after = optionalText(page?.data?.after);
        if (after && !reachedCheckpoint) pagination.next(after);
      } while (after && !reachedCheckpoint);

      const savedDoc = ctx.resolve("social/saved-posts.ttl");
      const posts = new Store();
      for (const child of saved) {
        const p = child.data;
        const post = new SocialMediaPosting(`${savedDoc}#post-${p.id}`, posts, DataFactory).mark();
        post.headline = p.title;
        post.identifier = p.name;
        post.isPartOf = `r/${p.subreddit}`;
        post.sourceUrl = `https://www.reddit.com${p.permalink}`;
        post.datePublished = Number.isFinite(p.created_utc)
          ? optionalDate(String(new Date(p.created_utc * 1000)))
          : undefined;
      }
      await ctx.write({
        slug: "social/saved-posts.ttl",
        category: "social",
        forClass: CLASSES.SocialMediaPosting,
        dataset: posts,
        writeMode: ctx.cursor ? "merge" : "replace",
        sourceUrl: savedUrl,
      });

      ctx.progress({ label: "Fetching your communities…", done: 2, total: 3 });
      const subs: RedditSubreddit[] = [];
      const subsPagination = new Pagination(ID);
      after = undefined;
      do {
        budget.request();
        const page = await getJson<RedditListing<RedditSubreddit>>(
          ID,
          ctx.api,
          `${API}/subreddits/mine/subscriber?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
          undefined,
          budget,
        );
        const children = arr(page?.data?.children);
        budget.items(children.length);
        subs.push(...children);
        after = optionalText(page?.data?.after);
        if (after) subsPagination.next(after);
      } while (after);

      const subsDoc = ctx.resolve("social/communities.ttl");
      const groups = new Store();
      for (const child of subs) {
        const s = child?.data;
        if (!s || !optionalText(s.display_name)) {
          skipped.skip();
          continue;
        }
        const group = new Group(`${subsDoc}#sub-${s.display_name}`, groups, DataFactory).mark();
        group.name = s.title || s.display_name;
        group.identifier = s.display_name;
        group.description = s.public_description || undefined;
        group.sourceUrl = `https://www.reddit.com${s.url}`;
      }
      await ctx.write({
        slug: "social/communities.ttl",
        category: "social",
        forClass: CLASSES.Group,
        dataset: groups,
        sourceUrl: `${API}/subreddits/mine/subscriber`,
      });

      ctx.progress({ label: "Done", done: 3, total: 3 });
      return { cursor: newest ?? ctx.cursor, skipped: skipped.value };
    },
  };
}

export const redditAdapter: IntegrationAdapter = createRedditAdapter();
