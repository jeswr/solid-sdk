// AUTHORED-BY Codex GPT-6.1-Sol
// Opt-in disposable forum acceptance. No model/planner CLI or evaluator.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createExecutorFetch,
  createTaskExecutor,
  loginWithPassword,
  type PlannerInput,
  runTask,
  scriptedPlanner,
} from "@jeswr/agent-browser";
import { InMemorySessions } from "@jeswr/site-executor";
import {
  type Operation,
  readSiteModel,
  validateSiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { launchChromium, profileSite } from "@jeswr/site-profiler";
import { Parser } from "n3";
import { expect, it } from "vitest";
import { deleteOwnForumPost, forumDemonstration, forumFixture } from "./support/forum.js";
import { forumAction } from "./support/forum-action.js";
import { liveTransport } from "./support/live-transport.js";

const s = "https://schema.org/";
function need<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("Missing forum acceptance value");
  return v;
}
it.skipIf(!process.env.SAB_LIVE_FORUM_URL)(
  "learns and replays disposable forum writes behind approval",
  async () => {
    const origin = new URL(need(process.env.SAB_LIVE_FORUM_URL)).origin;
    const credentials = { username: "MarvelsGrantMan136", password: "test1234" };
    const result = await profileSite({
      startUrl: `${origin}/forums`,
      login: credentials,
      maxPages: 16,
      networkIdleTimeoutMs: 500,
      navigationTimeoutMs: 8000,
      maxProfileMs: 180000,
      demonstrations: [forumDemonstration(origin, forumFixture())],
    });
    expect(result.warnings.filter((w) => w.startsWith("demonstration"))).toEqual([]);
    expect(validateSiteModel(result.model)).toEqual([]);
    if (process.env.SAB_LIVE_OUTPUT_DIR) {
      await mkdir(process.env.SAB_LIVE_OUTPUT_DIR, { recursive: true, mode: 0o700 });
      await writeFile(
        join(process.env.SAB_LIVE_OUTPUT_DIR, "forum-learning.json"),
        JSON.stringify(
          {
            model: result.model,
            writeResponses: result.writeResponses,
            redirects: result.trace
              .filter(
                (r) =>
                  r.phase === "demonstration" && (r.redirectedTo || r.redirectedFrom !== undefined),
              )
              .map((r) => ({
                seq: r.seq,
                method: r.method,
                url: r.url,
                status: r.status,
                redirectedTo: r.redirectedTo,
                redirectedFrom: r.redirectedFrom,
                bodyTruncated: r.bodyTruncated,
              })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    const model = readSiteModel(await writeSiteModel(result.model));
    const op = (pattern: RegExp, kind?: string) =>
      need(
        model.operations.find(
          (o) =>
            pattern.test(o.request.urlTemplate) && (!kind || o.extraction?.itemType === s + kind),
        ),
      );
    const create = need(
        model.operations.find(
          (o) => o.effect !== "read" && /\/submit$/.test(o.request.urlTemplate),
        ),
      ),
      comment = need(
        model.operations.find((o) => o.effect !== "read" && o.actionType === `${s}CommentAction`),
      );
    const edit = need(
      model.operations.find(
        (o) => o.effect !== "read" && /\/comment\/.*\/edit$/.test(o.request.urlTemplate),
      ),
    );
    const vote = need(model.operations.find((o) => o.actionType === `${s}VoteAction`));
    const delComment = need(
      model.operations.find(
        (o) => o.effect !== "read" && /delete_own$/.test(o.request.urlTemplate),
      ),
    );
    const delPost = need(
      model.operations.find(
        (o) => o.effect !== "read" && /\/-\/delete$/.test(o.request.urlTemplate),
      ),
    );
    const search = op(/\/search/, "DiscussionForumPosting");
    const forumChoices = op(/\/submit$/, "CreativeWork");
    const posts = need(
      model.operations.find(
        (o) =>
          o.extraction?.itemType === `${s}DiscussionForumPosting` &&
          o.inputs.some((p) => p.name === "sort") &&
          /\/f\//.test(o.request.urlTemplate),
      ),
    );
    const detail = need(
      model.operations.find(
        (o) =>
          o.extraction?.itemType === `${s}DiscussionForumPosting` &&
          /\/f\//.test(o.request.urlTemplate) &&
          !o.request.urlTemplate.includes("/-/") &&
          o.inputs.some((p) => p.location === "path" && /^\d+$/.test(p.example ?? "")),
      ),
    );
    const comments = need(
      model.operations.find(
        (o) =>
          o.extraction?.itemType === `${s}Comment` &&
          /\/f\//.test(o.request.urlTemplate) &&
          !o.request.urlTemplate.includes("/-/") &&
          o.inputs.some((p) => p.location === "path" && /^\d+$/.test(p.example ?? "")),
      ),
    );
    for (const o of [create, comment, edit, vote, delComment, delPost]) {
      expect(o.effect).toBe("irreversible-write");
      expect(o.provenance.method).toBe("demonstration");
      expect(o.csrf?.length).toBeGreaterThan(0);
    }
    const sessions = new InMemorySessions(),
      calls: Array<{ method: string; path: string }> = [];
    const transport = liveTransport(origin, calls);
    await loginWithPassword(
      model,
      createExecutorFetch({ model, sessions, fetch: transport }),
      credentials,
    );
    calls.length = 0;
    const executor = createTaskExecutor({
      model,
      sessions,
      fetch: transport,
      writeResponses: result.writeResponses,
    });
    const item = forumFixture();
    let postId = "",
      commentId = "";
    const approvals: Array<{ summary: string; decision: string; calls: number; posts: number }> =
      [];
    const sent = () => calls.filter((c) => c.method === "POST").length;
    const last = (input: PlannerInput) => need(input.history.at(-1));
    const facts = (input: PlannerInput) => new Parser().parse(last(input).observations);
    const identity = (input: PlannerInput) =>
      need(facts(input).find((q) => q.predicate.value === `${s}identifier`)?.object.value);
    const values = (o: Operation): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const p of o.inputs) {
        const semantic: Record<string, string> = {
          title: item.title,
          body: item.body,
          forum: item.forum,
          forumName: item.forumName,
          text: item.comment,
          choice: "1",
          q: item.title,
          sort: "new",
        };
        if (semantic[p.name] !== undefined) out[p.name] = semantic[p.name] as string;
        else if (p.location === "path")
          out[p.name] = p.name.toLowerCase().includes("comment")
            ? commentId
            : /^\d+$/.test(p.example ?? "")
              ? postId
              : p.example === item.forumName
                ? item.forumName
                : (item.postUrl.split("/").at(-1) ?? "");
      }
      return out;
    };
    const write = (o: Operation, extra: Record<string, string> = {}) =>
      forumAction(
        o,
        { ...values(o), ...extra },
        [edit, delComment].includes(o) ? `Comment ${commentId} on ${item.title}` : item.title,
      );
    const cursor = need(posts.inputs.find((p) => decodeURIComponent(p.name) === "next[id]"));
    // Imported fixtures can have IDs above the database's fresh sequence. The learned
    // exclusive cursor lets the forum read include this newly created identity.
    const readForum = () =>
      forumAction(posts, { ...values(posts), [cursor.name]: String(Number(postId) + 1) });
    const readPost = () => forumAction(detail, values(detail));
    const readComments = () => forumAction(comments, values(comments));
    let expectedPosts = 0,
      repeatCalls = 0;
    const cycle = (
      operation: Operation,
      extra: Record<string, string> = {},
      after?: (input: PlannerInput) => void,
      readAfter: () => Promise<string> = readPost,
    ) => [
      async (input: PlannerInput) => {
        if (operation === create) {
          const graph = facts(input);
          const label = need(
            graph.find(
              (q) =>
                q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#value" &&
                q.object.value === item.forumName,
            ),
          );
          const owner = need(
            graph.find((q) => q.predicate.value === `${s}name` && q.object.equals(label.subject)),
          );
          item.forum = need(
            graph.find(
              (q) => q.subject.equals(owner.subject) && q.predicate.value === `${s}identifier`,
            )?.object.value,
          );
        }
        if (operation === comment) expect(last(input).observations).toContain(item.title);
        return { kind: "act" as const, turtle: await write(operation, extra) };
      },
      async (input: PlannerInput) => {
        expect(last(input).status).toBe("denied");
        expect(calls).toHaveLength(need(approvals.at(-1)).calls);
        expect(sent()).toBe(expectedPosts);
        return { kind: "act" as const, turtle: await write(operation, extra) };
      },
      async (input: PlannerInput) => {
        expect(last(input).status, last(input).error).toBe("done");
        expect(last(input).observations).toContain("Completed");
        expect(sent()).toBe(++expectedPosts);
        after?.(input);
        return { kind: "act" as const, turtle: await readAfter() };
      },
    ];
    let plannerFailure: unknown;
    const guard = (planner: ReturnType<typeof scriptedPlanner>) => ({
      async next(input: PlannerInput) {
        try {
          return await planner.next(input);
        } catch (error) {
          plannerFailure = error;
          return { kind: "answer" as const, text: "Acceptance assertion failed" };
        }
      },
    });
    try {
      const trace = await runTask({
        goal: `Create, comment, edit, vote and delete ${item.title}`,
        model,
        executor,
        maxSteps: 40,
        observationBudget: 128000,
        approver: async (a) => {
          expect(a.summary).toContain(item.title);
          expect(a.summary).toContain("127.0.0.1:9999");
          const decision = approvals.length % 2 === 0 ? "deny" : "approve";
          approvals.push({ summary: a.summary, decision, calls: calls.length, posts: sent() });
          return decision;
        },
        planner: guard(
          scriptedPlanner([
            { kind: "act", turtle: await forumAction(forumChoices, {}) },
            ...cycle(create, {}, (input) => {
              postId = identity(input);
              item.postUrl = need(
                facts(input).find((q) => q.predicate.value === `${s}result`)?.object.value,
              );
            }),
            async (input) => {
              expect(last(input).observations).toContain(item.title);
              return { kind: "act", turtle: await readForum() };
            },
            ...cycle(
              comment,
              {},
              (input) => {
                commentId = identity(input);
                item.commentUrl = `${origin}/f/${item.forumName}/${postId}/-/comment/${commentId}`;
              },
              readComments,
            ),
            async (input) => {
              expect(last(input).observations).toContain(item.comment);
              expect(last(input).observations).toContain("UntrustedText");
              repeatCalls = calls.length;
              return { kind: "act", turtle: await write(comment) };
            },
            async (input) => {
              expect(last(input).status).toBe("repeat-blocked");
              expect(sent()).toBe(2);
              expect(calls).toHaveLength(repeatCalls);
              return { kind: "act", turtle: await readComments() };
            },
            ...cycle(edit, { text: item.edited }, undefined, readComments),
            async (input) => {
              expect(last(input).observations).toContain(item.edited);
              expect(last(input).observations).not.toContain(item.comment);
              return { kind: "act", turtle: await readPost() };
            },
            ...cycle(vote),
            ...cycle(delComment, {}, undefined, readComments),
            async (input) => {
              expect(last(input).observations).not.toContain(item.edited);
              expect(last(input).observations).not.toContain(item.commentUrl);
              return { kind: "act", turtle: await readPost() };
            },
            ...cycle(delPost, {}, undefined, () => forumAction(search, { q: item.title })),
            async (input) => {
              expect(last(input).observations).not.toContain(item.title);
              return { kind: "act", turtle: await readForum() };
            },
            (input) => {
              expect(last(input).observations).not.toContain(item.title);
              return { kind: "answer", text: "Forum cycle complete" };
            },
          ]),
        ),
      });
      console.log(
        "FORUM TRACE",
        JSON.stringify(trace.steps.map((st) => ({ status: st.status, error: st.error }))),
        "APPROVALS",
        approvals,
      );
      if (plannerFailure) throw plannerFailure;
      expect(trace.text).toBe("Forum cycle complete");
      expect(
        trace.steps.every((st) =>
          ["done", "denied", "repeat-blocked", "answer"].includes(st.status),
        ),
      ).toBe(true);
      expect(approvals).toHaveLength(12);
      expect(sent()).toBe(6);
      if (process.env.SAB_LIVE_OUTPUT_DIR) {
        await mkdir(process.env.SAB_LIVE_OUTPUT_DIR, { recursive: true, mode: 0o700 });
        await writeFile(
          join(process.env.SAB_LIVE_OUTPUT_DIR, "forum-acceptance.json"),
          JSON.stringify(
            {
              approvals,
              operations: [create, comment, edit, vote, delComment, delPost].map((o) => ({
                method: o.request.method,
                path: o.request.urlTemplate,
                inputs: o.inputs.map((p) => ({ name: p.name, path: p.path })),
                effect: o.effect,
              })),
              postId,
              commentId,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      }
    } finally {
      const browser = await launchChromium();
      try {
        const context = await browser.newContext();
        const bundle = await sessions.get(origin);
        await context.addCookies(
          (bundle?.cookies ?? []).map((c) => ({
            ...c,
            expires: c.expires ?? -1,
            httpOnly: c.httpOnly ?? false,
            secure: c.secure ?? false,
            sameSite: c.sameSite ?? "Lax",
          })),
        );
        const page = await context.newPage();
        await deleteOwnForumPost(page, origin, item);
      } finally {
        await browser.close();
      }
      if (process.env.SAB_LIVE_OUTPUT_DIR) {
        await writeFile(
          join(process.env.SAB_LIVE_OUTPUT_DIR, "forum-traffic.json"),
          JSON.stringify({ approvals, calls, postId, commentId }, null, 2),
          { mode: 0o600 },
        );
      }
    }
    console.log(
      "Forum operations",
      JSON.stringify(
        [create, comment, edit, vote, delComment, delPost].map((o) => ({
          method: o.request.method,
          path: o.request.urlTemplate,
          inputs: o.inputs.map((p) => p.name),
          effect: o.effect,
        })),
      ),
    );
  },
  300000,
);

it.skipIf(!process.env.SAB_LIVE_FORUM_URL)(
  "profiles HTML forum reads without demonstrations and replays typed untrusted facts",
  async () => {
    const origin = new URL(need(process.env.SAB_LIVE_FORUM_URL)).origin;
    const credentials = { username: "MarvelsGrantMan136", password: "test1234" };
    const learned = await profileSite({
      startUrl: `${origin}/f/AskReddit/10224`,
      login: credentials,
      maxPages: 16,
      networkIdleTimeoutMs: 500,
      navigationTimeoutMs: 8000,
      maxProfileMs: 180000,
    });
    const listing = await profileSite({
      startUrl: `${origin}/f/AskReddit/new`,
      login: credentials,
      maxPages: 1,
      maxProfileMs: 60000,
      networkIdleTimeoutMs: 500,
      modelId: "urn:sab:forum-list-reads",
    });
    const model = readSiteModel(
      await writeSiteModel({
        ...learned.model,
        operations: [
          ...learned.model.operations,
          ...listing.model.operations.filter((o) => o.effect === "read"),
        ],
      }),
    );
    expect(model.operations.filter((o) => o.effect !== "read")).toHaveLength(1);
    expect(model.login?.[0]?.sessionCookies?.length).toBeGreaterThan(0);
    const find = (type: string, pattern: RegExp) =>
      need(
        model.operations.find(
          (o) => o.extraction?.itemType === `${s}${type}` && pattern.test(o.request.urlTemplate),
        ),
      );
    const person = find("Person", /\/user\//),
      forums = find("CreativeWork", /\/forums/),
      post = find("DiscussionForumPosting", /\/f\//),
      comments = find("Comment", /\/f\//),
      search = find("DiscussionForumPosting", /\/search/);
    const sorted = need(
      model.operations.find(
        (o) =>
          o.extraction?.itemType === `${s}DiscussionForumPosting` &&
          o.inputs.some((p) => p.name === "sort") &&
          o.inputs.some((p) => decodeURIComponent(p.name).startsWith("next[")),
      ),
    );
    expect(sorted.inputs.some((p) => decodeURIComponent(p.name).startsWith("next["))).toBe(true);
    const sessions = new InMemorySessions(),
      calls: Array<{ method: string; path: string }> = [],
      transport = liveTransport(origin, calls);
    await loginWithPassword(
      model,
      createExecutorFetch({ model, sessions, fetch: transport }),
      credentials,
    );
    calls.length = 0;
    const executor = createTaskExecutor({ model, sessions, fetch: transport });
    for (const operation of [person, forums, post, comments, search, sorted]) {
      const values = Object.fromEntries(
        operation.inputs
          .filter((p) => p.required || p.name === "sort")
          .map((p) => [
            p.name,
            p.name === "q" ? "example" : p.name === "sort" ? "new" : need(p.example),
          ]),
      );
      if (operation === search) values.q = "example";
      const { parseActionRequest } = await import("@jeswr/site-model");
      const result = await executor.execute(
        parseActionRequest(await forumAction(operation, values)),
      );
      expect(result.status, result.error).toBe("done");
      console.log(
        "READ CHECK",
        operation.id,
        result.status,
        result.observations.map((o) => o.turtle?.slice(0, 300)),
      );
      const facts = result.observations.flatMap((o) => new Parser().parse(o.turtle ?? ""));
      expect(
        facts.some(
          (q) =>
            q.predicate.value.endsWith("type") && q.object.value === operation.extraction?.itemType,
        ),
      ).toBe(true);
      expect(facts.some((q) => q.object.value.endsWith("UntrustedText"))).toBe(true);
    }
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  },
  240000,
);
