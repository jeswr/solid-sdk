// AUTHORED-BY Claude Opus 5.5
//
// Hardening regressions (sst-8xm.9.23): each case pins a defect the adversarial
// review reproduced in the native seams.
import { describe, expect, test, vi } from "vitest";
import { type AuthSessionPlugin, createNativeCodeDriver } from "./auth-session.js";
import { mobileClientIdDocument } from "./client-id.js";
import { AuthorizationError, AuthorizationRequestError, ShareUnavailableError } from "./errors.js";
import { refreshTokenKey } from "./secure-store.js";
import { share } from "./share.js";
import {
  createShareInbox,
  DEFAULT_SHARE_LIMITS,
  sanitiseFileName,
  validateShareBatch,
} from "./share-intake.js";
import { type ShareStagingPlugin, stageFile } from "./share-staging.js";

const REDIRECT = "org.jeswr.suite:/oauth/callback";
const ISSUER = "https://idp.example/";
const ISS = `iss=${encodeURIComponent(ISSUER)}`;

function authUrl(extra: Record<string, string> = {}): URL {
  const url = new URL("https://idp.example/authorize");
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: "https://suite.example/.well-known/solid-client-id-mobile.jsonld",
    redirect_uri: REDIRECT,
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "s1",
    ...extra,
  })) {
    url.searchParams.append(key, value);
  }
  return url;
}

const driver = (callback: string) =>
  createNativeCodeDriver({
    plugin: {
      authenticate: vi.fn(async () => ({ url: callback })),
      cancel: vi.fn(async () => undefined),
    } as unknown as AuthSessionPlugin,
    redirectUri: REDIRECT,
    resolveIssuer: () => ISSUER,
  });

describe("authorization requests and responses", () => {
  test.each([
    ["request_uri", "urn:ietf:params:oauth:request_uri:abc"],
    ["request", "eyJhbGciOiJub25lIn0.e30."],
  ])("refuses a %s parameter that would override the checked fields", async (key, value) => {
    await expect(
      driver(`${REDIRECT}?code=c&state=s1&${ISS}`)(
        authUrl({ [key]: value }),
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AuthorizationRequestError);
  });

  test("an error description outside the RFC 6749 charset is dropped", async () => {
    const description = encodeURIComponent('<img src=x onerror="alert(1)">');
    const error = await driver(
      `${REDIRECT}?error=access_denied&error_description=${description}&state=s1&${ISS}`,
    )(authUrl(), new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({ code: "access_denied", description: undefined });
  });

  test("an over-long or malformed error code is refused", async () => {
    for (const code of ["x".repeat(129), encodeURIComponent('bad"code')]) {
      await expect(
        driver(`${REDIRECT}?error=${code}&state=s1&${ISS}`)(
          authUrl(),
          new AbortController().signal,
        ),
      ).rejects.toBeInstanceOf(AuthorizationRequestError);
    }
  });
});

describe("mobile Client ID Document", () => {
  test.each([
    "//evil.example/x.png",
    "/\\evil.example/x.png",
  ])("refuses an off-origin logoPath %j", (logoPath) => {
    expect(() => mobileClientIdDocument({ origin: "https://suite.example", logoPath })).toThrow(
      TypeError,
    );
  });

  test("refuses a redirect URI the native driver would refuse", () => {
    expect(() =>
      mobileClientIdDocument({
        origin: "https://suite.example",
        redirectUri: "https://evil.example/cb",
      }),
    ).toThrow(TypeError);
  });
});

describe("refreshTokenKey", () => {
  test("refuses identity fields that are not non-empty strings", async () => {
    const good = { issuer: ISSUER, webId: "https://alice.example/#me", clientId: "c" };
    for (const bad of [
      { ...good, issuer: undefined },
      { ...good, issuer: null },
      { ...good, webId: "" },
    ]) {
      await expect(refreshTokenKey(bad as unknown as typeof good)).rejects.toThrow(TypeError);
    }
  });
});

describe("shared-in files", () => {
  test.each([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/javascript",
  ])("an active declared type (%s) reaches the Blob as application/octet-stream", async (mimeType) => {
    const batch = validateShareBatch(
      {
        id: "b-1",
        receivedAt: "2026-10-26T19:00:00Z",
        items: [{ kind: "file", name: "invoice.pdf", mimeType, size: 3 }],
      },
      DEFAULT_SHARE_LIMITS,
    );
    expect(batch.items[0]).toMatchObject({ mimeType: "application/octet-stream" });
    const inbox = createShareInbox({
      getPending: async () => ({ batches: [] }),
      readChunk: async () => ({ data: btoa("abc"), eof: true }),
      acknowledge: async () => undefined,
      addListener: async () => ({ remove: async () => undefined }),
    });
    expect((await inbox.readFile(batch, 0)).type).toBe("application/octet-stream");
  });

  test("a passive type is kept", () => {
    const batch = validateShareBatch(
      {
        id: "b-1",
        receivedAt: "2026-10-26T19:00:00Z",
        items: [{ kind: "file", name: "a.pdf", mimeType: "application/pdf", size: 3 }],
      },
      DEFAULT_SHARE_LIMITS,
    );
    expect(batch.items[0]).toMatchObject({ mimeType: "application/pdf" });
  });

  test.each([
    ["%2e%2e", "_2e_2e"],
    ["?acl=1", "_acl=1"],
    ["#x", "_x"],
    ["javascript:alert(1)", "javascript_alert(1)"],
    ["report‮fdp.exe", "report_fdp.exe"],
    ["a\u0085b", "a_b"],
  ])("sanitiseFileName(%j) is one inert path segment", (raw, expected) => {
    const name = sanitiseFileName(raw);
    expect(name).toBe(expected);
    expect(new URL(name, "https://pod.example/inbox/").href).toBe(
      `https://pod.example/inbox/${encodeURI(name)}`,
    );
  });

  test("names are capped at 255 UTF-8 bytes without splitting a character", () => {
    const name = sanitiseFileName("\u{1F600}".repeat(200));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(name).toBe("\u{1F600}".repeat(63));
    expect(sanitiseFileName("a\ud800b")).toBe("a�b");
  });
});

describe("staging and sharing", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const staging = (uri: string) => ({
    begin: vi.fn<ShareStagingPlugin["begin"]>().mockResolvedValue({ stagingId: id }),
    writeChunk: vi.fn<ShareStagingPlugin["writeChunk"]>().mockResolvedValue(),
    commit: vi.fn<ShareStagingPlugin["commit"]>().mockResolvedValue({ uri }),
    abort: vi.fn<ShareStagingPlugin["abort"]>().mockResolvedValue(),
  });

  test.each([
    `file:///data/files/secret/share-out/${id}/a.pdf`,
    `file:///cache/share-out/${id}/%E0%A4%A.pdf`,
  ])("refuses a committed URI outside the share-out store: %s", async (uri) => {
    const p = staging(uri);
    await expect(stageFile(new Blob(["x"]), { name: "a.pdf" }, p)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(p.abort).toHaveBeenCalledWith({ stagingId: id });
  });

  test("a failure that only mentions cancelling is a failure, not a dismissal", async () => {
    const native = {
      canShare: vi.fn(async () => ({ value: true })),
      share: vi.fn(async () => {
        throw new Error("Could not cancel the previous share: storage full");
      }),
    };
    await expect(share({ text: "hi" }, { native })).rejects.toBeInstanceOf(ShareUnavailableError);
    native.share.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(share({ text: "hi" }, { native })).resolves.toEqual({ completed: false });
  });
});
