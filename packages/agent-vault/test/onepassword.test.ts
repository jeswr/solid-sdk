// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { inspect } from "util";
import { describe, expect, it, vi } from "vitest";
import { OnePasswordCliBackend, type OpAccount, type RunRequest, Secret } from "../src/index.js";
import { login, PASSWORD, SITE } from "./helpers.js";

const serviceToken = "fixture-service-token";
const accounts: OpAccount[] = [
  { account: "family", profile: "personal", vault: "home", auth: { mode: "desktop" } },
  {
    account: "business",
    profile: "work",
    vault: "office",
    auth: { mode: "service", token: async () => new Secret(serviceToken) },
  },
];
const item = (id = "item-a", url = SITE) => ({
  id,
  category: "LOGIN",
  urls: [{ href: url }],
  fields: [
    { id: "username", value: "alex@example.test" },
    { id: "password", value: PASSWORD },
  ],
});
describe("1Password CLI adapter", () => {
  it("searches multiple accounts independently and scopes service credentials to child env", async () => {
    const requests: RunRequest[] = [];
    const runner = vi.fn(async (r: RunRequest) => {
      requests.push(r);
      return {
        stdout: JSON.stringify([
          item(),
          item("wrong", "https://other.test"),
          item("http", "http://shop.test"),
          item("sub", "https://sub.shop.test"),
          item("suffix", "https://shop.test.evil.test"),
          item("malformed", "not a url"),
        ]),
      };
    });
    const b = new OnePasswordCliBackend({ accounts, runner });
    expect(await b.find(SITE)).toEqual([
      { backend: "onepassword", ref: "family/item-a", profile: "personal" },
      { backend: "onepassword", ref: "business/item-a", profile: "work" },
    ]);
    expect(requests[0]?.env).toEqual({});
    expect(requests[1]?.env).toEqual({ OP_SERVICE_ACCOUNT_TOKEN: serviceToken });
    expect(requests[0]?.argv).toContain("family");
    expect(requests[1]?.argv).toContain("business");
    expect(JSON.stringify(requests.map((r) => r.argv))).not.toContain(serviceToken);
  });
  it("allows only explicitly trusted domain groups, preserving scheme and port", async () => {
    const runner = async () => ({
      stdout: JSON.stringify([
        item("sub", "https://sub.shop.test/path"),
        item("evil", "https://evilshop.test"),
        item("port", "https://shop.test:444"),
        item("userinfo", "https://x:secret@shop.test"),
      ]),
    });
    expect(
      await new OnePasswordCliBackend({
        accounts: [accounts[0] as OpAccount],
        runner,
        domainGroups: ["shop.test"],
      }).find(SITE),
    ).toEqual([{ backend: "onepassword", ref: "family/sub", profile: "personal" }]);
  });
  it("reads secrets through stdout and creates or edits using JSON stdin exclusively", async () => {
    const requests: RunRequest[] = [];
    const runner = async (r: RunRequest) => {
      requests.push(r);
      return { stdout: JSON.stringify(item(r.argv.includes("create") ? "created" : "item-a")) };
    };
    const b = new OnePasswordCliBackend({ accounts, runner });
    const credentials = await b.read("business/item-a", "login");
    expect(await credentials.use((c) => c.password === PASSWORD)).toBe(true);
    expect(inspect(credentials)).not.toContain(PASSWORD);
    expect(await b.save(login("business/new"))).toMatchObject({
      ref: "business/created",
      profile: "work",
    });
    await b.save(login("family/item-a"));
    const writes = requests.filter((r) => r.stdin);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0]?.stdin ?? "{}").fields[1].value).toBe(PASSWORD);
    expect(writes[0]?.argv).toContain("-");
    expect(JSON.stringify(requests.map((r) => r.argv))).not.toContain(PASSWORD);
  });
  it.each([
    '"012345"',
    "012345",
    "123456",
    '"12345678"',
  ])("obtains OTP from stdout: %s", async (stdout) => {
    const b = new OnePasswordCliBackend({ accounts, runner: async () => ({ stdout }) });
    expect(await (await b.totp("family/item-a")).use((v) => /^\d{6,8}$/.test(v))).toBe(true);
  });
  it.each([
    "bogus",
    '"not-code"',
    '{"password":"fixture-password-secret"}',
  ])("refuses malformed OTP without diagnostics", async (stdout) => {
    const b = new OnePasswordCliBackend({ accounts, runner: async () => ({ stdout }) });
    await expect(b.totp("family/item-a")).rejects.toThrow("Vault invalid");
  });
  it("refuses cross-account refs, unexpected returned IDs and unrelated updates", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify(item("other", "https://other.test")),
    }));
    const b = new OnePasswordCliBackend({ accounts, runner });
    for (const ref of ["missing/item-a", "family/--flags", "family/id/more"])
      await expect(b.read(ref, "login")).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
    await expect(b.read("family/item-a", "login")).rejects.toThrow();
    await expect(b.save(login("family/item-a"))).rejects.toThrow();
    await expect(b.save(login())).rejects.toThrow();
    await expect(b.read("family/item-a", "totp" as never)).rejects.toThrow("Vault denied");
  });
  it("sanitises process failures and malformed JSON even when they contain credentials", async () => {
    for (const runner of [
      async () => {
        throw new Error(PASSWORD + serviceToken);
      },
      async () => ({ stdout: PASSWORD }),
    ]) {
      const b = new OnePasswordCliBackend({ accounts, runner });
      const error = await b.read("business/item-a", "login").catch((e) => e);
      expect(
        [String(error), inspect(error, { showHidden: true }), JSON.stringify(error)].join(),
      ).not.toContain(PASSWORD);
      expect(inspect(error)).not.toContain(serviceToken);
    }
  });
  it("rejects empty/duplicate configurations and option injection", () => {
    expect(() => new OnePasswordCliBackend({ accounts: [] })).toThrow();
    expect(
      () =>
        new OnePasswordCliBackend({
          accounts: [accounts[0] as OpAccount, accounts[0] as OpAccount],
        }),
    ).toThrow();
    expect(
      () =>
        new OnePasswordCliBackend({
          accounts: [{ ...(accounts[0] as OpAccount), account: "--bad" }],
        }),
    ).toThrow();
    expect(() => new OnePasswordCliBackend({ accounts, domainGroups: ["test"] })).toThrow();
  });
});
it("applies explicit origin groups to credential use as well as discovery", () => {
  const b = new OnePasswordCliBackend({
    accounts,
    domainGroups: ["shop.test"],
    runner: async () => ({ stdout: "[]" }),
  });
  expect(b.allowsOrigin(SITE, "https://sub.shop.test")).toBe(true);
  expect(b.allowsOrigin(SITE, "https://other.test")).toBe(false);
  expect(b.allowsOrigin(SITE, "http://shop.test")).toBe(false);
});
