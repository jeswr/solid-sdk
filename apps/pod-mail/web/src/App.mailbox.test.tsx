// AUTHORED-BY Codex GPT-6
// AUTHORED-BY GPT-6.1 Sol

import type { SignedInSession } from "@jeswr/app-session/react";
import { POD_ROOT, WEB_ID } from "@jeswr/app-session/testing";
import { ThemeProvider } from "@jeswr/app-shell";
import { render, screen } from "@testing-library/react";
import { DataFactory, Writer } from "n3";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
const session = { webId: WEB_ID, podRoot: POD_ROOT, podRootIsFallback: false };
vi.mock("@jeswr/app-session/react", async (original) => ({
  ...(await original<typeof import("@jeswr/app-session/react")>()),
  // This test supplies a signed-in fixture; App.extension.test.tsx exercises the real gate.
  SessionGate: ({ children }: { children: (signedIn: SignedInSession) => ReactNode }) =>
    children({ webId: WEB_ID, session }),
  useSession: () => ({
    webId: WEB_ID,
    session,
    fetch: seams.fetch,
    logout: vi.fn(),
    restoringSession: false,
    ready: true,
    error: null,
  }),
}));
vi.mock("@jeswr/solid-elements/react", () => ({
  Loading: ({ label }: { label: string }) => <span role="status">{label}</span>,
}));

import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

it("threads session fetch through profile, private Type Index and the real Inbox store", async () => {
  const ambient = vi.fn<typeof fetch>(async () => new Response("public", { status: 401 }));
  vi.stubGlobal("fetch", ambient);
  const indexUrl = `${POD_ROOT}settings/privateTypeIndex.ttl`;
  const mailRoot = `${POD_ROOT}custom-mail/`;
  const mailboxUrl = `${mailRoot}folders/inbox.ttl`;
  const { namedNode: n, literal, quad } = DataFactory;
  const solid = "http://www.w3.org/ns/solid/terms#";
  const message = n(`${mailboxUrl}#message`);
  const registration = n(`${indexUrl}#mail`);
  const documents = new Map([
    [WEB_ID, [quad(n(WEB_ID), n(`${solid}privateTypeIndex`), n(indexUrl))]],
    [
      indexUrl,
      [
        quad(
          registration,
          n("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          n(`${solid}TypeRegistration`),
        ),
        quad(registration, n(`${solid}forClass`), n("http://schema.org/EmailMessage")),
        quad(registration, n(`${solid}instanceContainer`), n(mailRoot)),
      ],
    ],
    [
      mailboxUrl,
      [
        quad(
          message,
          n("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
          n("http://schema.org/EmailMessage"),
        ),
        quad(message, n("http://schema.org/headline"), literal("A private message")),
      ],
    ],
  ]);
  seams.fetch.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const quads = documents.get(url);
    if (!quads) throw new Error(`Unexpected pod read: ${url}`);
    const writer = new Writer();
    writer.addQuads(quads);
    const turtle = await new Promise<string>((resolve, reject) =>
      writer.end((error, value) => (error ? reject(error) : resolve(value))),
    );
    return new Response(turtle, { headers: { "content-type": "text/turtle" } });
  });
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  expect(await screen.findByRole("button", { name: "A private message" })).toBeVisible();
  expect(seams.fetch.mock.calls.map(([input]) => String(input))).toEqual([
    WEB_ID,
    indexUrl,
    mailboxUrl,
  ]);
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(ambient).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(ambient);
  expect((await globalThis.fetch(mailboxUrl)).status).toBe(401);
});
