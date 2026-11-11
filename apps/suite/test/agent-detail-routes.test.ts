// AUTHORED-BY Codex GPT-6.1-Sol
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { h, mount } from "./drive-ui-dom";

const navigation = vi.hoisted(() => ({
  pathname: null as string | null,
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => {
    throw new Error("Native routing must not read the placeholder params");
  },
  usePathname: () => navigation.pathname,
  notFound: navigation.notFound,
}));
vi.mock("../src/apps/agent/components/accounts", () => ({
  AccountsScreen: ({ id }: { id: string }) => h("span", { "data-screen": "accounts" }, id),
}));
vi.mock("../src/apps/agent/components/activity", () => ({
  ActivityScreen: ({ seq }: { seq: string }) => h("span", { "data-screen": "activity" }, seq),
}));
vi.mock("../src/apps/agent/components/approvals", () => ({
  ApprovalsScreen: ({ id }: { id: string }) => h("span", { "data-screen": "approvals" }, id),
}));
vi.mock("../src/apps/agent/components/chat", () => ({
  ChatScreen: ({ id }: { id: string }) => h("span", { "data-screen": "chat" }, id),
}));
vi.mock("../src/apps/agent/components/inbox", () => ({
  InboxScreen: ({ binding }: { binding: string }) => h("span", { "data-screen": "inbox" }, binding),
}));

const routes = [
  {
    screen: "accounts",
    prefix: "/agent/accounts",
    param: "id",
    load: () => import("@/app/(suite)/agent/accounts/[id]/page"),
  },
  {
    screen: "activity",
    prefix: "/agent/activity",
    param: "seq",
    load: () => import("@/app/(suite)/agent/activity/[seq]/page"),
  },
  {
    screen: "approvals",
    prefix: "/agent/approvals",
    param: "id",
    load: () => import("@/app/(suite)/agent/approvals/[id]/page"),
  },
  {
    screen: "chat",
    prefix: "/agent/chat/c",
    param: "id",
    load: () => import("@/app/(suite)/agent/chat/c/[id]/page"),
  },
  {
    screen: "inbox",
    prefix: "/agent/inbox",
    param: "binding",
    load: () => import("@/app/(suite)/agent/inbox/[binding]/page"),
  },
] as const;

const params = (slug: string) => Promise.resolve({ id: slug, seq: slug, binding: slug });

beforeAll(async () => {
  // The route hook selects its implementation at import time, just as Next bakes in the target.
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  await Promise.all(routes.map((route) => route.load()));
});
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "native");
  navigation.pathname = null;
  navigation.notFound.mockClear();
});
afterAll(() => vi.unstubAllEnvs());

describe.each(routes)("$screen detail route", ({ screen, prefix, param, load }) => {
  it("passes the decoded pathname slug to the screen and follows sibling navigation", async () => {
    const { default: Page } = await load();
    navigation.pathname = `${prefix}/mail%2Ework-1/`;
    const page = await Page({ params: params("__") });
    const view = await mount(page);
    expect(view.host.querySelector(`[data-screen="${screen}"]`)?.textContent).toBe("mail.work-1");
    navigation.pathname = `${prefix}/next_2/`;
    await view.render(await Page({ params: params("__") }));
    expect(view.host.querySelector(`[data-screen="${screen}"]`)?.textContent).toBe("next_2");
    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  it("shows the skeleton until the placeholder has a real pathname", async () => {
    const { default: Page } = await load();
    const page = await Page({ params: params("__") });
    const view = await mount(page);
    expect(view.host.querySelector('[aria-label="Loading agent records"]')).not.toBeNull();
    expect(view.host.querySelector("[data-screen]")).toBeNull();
    navigation.pathname = `${prefix}/__/`;
    await view.render(await Page({ params: params("__") }));
    expect(view.host.querySelector('[aria-label="Loading agent records"]')).not.toBeNull();
    navigation.pathname = `${prefix}/ready/`;
    await view.render(await Page({ params: params("__") }));
    expect(view.host.querySelector('[aria-label="Loading agent records"]')).toBeNull();
    expect(view.host.querySelector(`[data-screen="${screen}"]`)?.textContent).toBe("ready");
    expect(navigation.notFound).not.toHaveBeenCalled();
  });

  it.each([
    "bad!",
    "a..b",
    "a".repeat(129),
  ])("rejects the invalid pathname slug %s with notFound", async (slug) => {
    const { default: Page } = await load();
    navigation.pathname = `${prefix}/${slug}/`;
    const page = await Page({ params: params("__") });
    await expect(mount(page)).rejects.toThrow("not-found");
    expect(navigation.notFound).toHaveBeenCalled();
  });

  it("validates server params on web and keeps native placeholder generation unchanged", async () => {
    const { default: Page, dynamicParams, generateStaticParams } = await load();
    expect(dynamicParams).toBe(true);
    expect(generateStaticParams()).toEqual([{ [param]: "__" }]);
    // Native must not depend on server params, even when they are invalid or unavailable.
    await expect(Page({ params: params("bad!") })).resolves.toBeDefined();
    const pending = new Promise<Awaited<ReturnType<typeof params>>>(() => {});
    await expect(Page({ params: pending })).resolves.toBeDefined();
    vi.stubEnv("NEXT_PUBLIC_SUITE_TARGET", "web");
    expect(generateStaticParams()).toEqual([]);
    await expect(Page({ params: params("valid_1") })).resolves.toBeDefined();
    expect(navigation.notFound).not.toHaveBeenCalled();
    await expect(Page({ params: params("bad!") })).rejects.toThrow("not-found");
    expect(navigation.notFound).toHaveBeenCalledOnce();
  });
});
