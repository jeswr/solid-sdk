// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8
//
// The inbox VIEW + its data hook, driven by a stubbed authenticated fetch (the
// auth seam). Proves the view renders a real mailbox document (parsed by the
// data layer), opens a message read-only and returns to the list, renders the
// empty / loading / error / access-denied states, and — critically — renders
// UNTRUSTED message content defensively (no HTML injection, no unsafe sender
// link). All with NO real pod and NO login flow.

import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "../../src/ui/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const M1 = "https://pod.example/mail/messages/m1.ttl#it";
const M2 = "https://pod.example/mail/messages/m2.ttl#it";

// A mailbox with two messages: m1 unread (from Alice), m2 read (from Bob, with
// a To + Cc and a multi-line body).
const INBOX = `
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${M1}> a schema:EmailMessage ;
  schema:headline "Lunch?" ;
  schema:sender <https://alice.example/profile/card#me> ;
  schema:text "Are you free at noon?" ;
  schema:dateSent "2026-06-10T11:00:00Z"^^xsd:dateTime .
<${M2}> a schema:EmailMessage ;
  schema:headline "Report" ;
  schema:sender <https://bob.example/profile/card#me> ;
  schema:toRecipient <https://carol.example/card#me> ;
  schema:ccRecipient <https://dave.example/card#me> ;
  schema:text "Line one.\\nLine two." ;
  schema:dateSent "2026-06-12T15:30:00Z"^^xsd:dateTime ;
  schema:dateRead "2026-06-12T16:00:00Z"^^xsd:dateTime .
`;

const EMPTY = `@prefix schema: <http://schema.org/> .`;

/** A 200 Turtle Response. */
function ttl(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/turtle", etag: '"v1"' },
  });
}

/** A fake authenticated fetch returning a fixed body for any GET. */
function bodyFetch(body: string): typeof globalThis.fetch {
  return (async () => ttl(body)) as unknown as typeof globalThis.fetch;
}

/** A fake fetch that always returns the given status (401/403/404 paths). */
function statusFetch(status: number): typeof globalThis.fetch {
  return (async () => new Response(null, { status })) as unknown as typeof globalThis.fetch;
}

describe("Inbox", () => {
  it("renders the message list newest-first with sender / subject / date", async () => {
    render(
      <Inbox
        mailboxUrl="https://pod.example/mail/folders/inbox.ttl"
        fetch={bodyFetch(INBOX)}
        title="Inbox"
      />,
    );
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await screen.findByRole("button", { name: "Report" });
    const rows = screen.getAllByRole("row");
    // rows[0] header; rows[1] newest (Report, 2026-06-12); rows[2] (Lunch?).
    expect(rows[1]).toHaveTextContent("Report");
    expect(rows[1]).toHaveTextContent("bob.example");
    expect(rows[1]).toHaveTextContent("2026-06-12 15:30");
    expect(rows[2]).toHaveTextContent("Lunch?");
    expect(rows[2]).toHaveTextContent("alice.example");
  });

  it("opens a message read-only (subject/from/to/cc/date/body) and returns via Back", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(INBOX)} />,
    );
    const open = await screen.findByRole("button", { name: "Report" });
    await act(async () => {
      open.click();
    });

    // Reading pane shows the message detail.
    expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument();
    const article = screen.getByRole("article", { name: "Message" });
    expect(article).toHaveTextContent("carol.example"); // To
    expect(article).toHaveTextContent("dave.example"); // Cc
    expect(article).toHaveTextContent("2026-06-12 15:30");
    expect(article).toHaveTextContent("Line one.");
    expect(article).toHaveTextContent("Line two.");
    // The list is hidden while reading.
    expect(screen.queryByRole("button", { name: "Lunch?" })).not.toBeInTheDocument();

    // Back returns to the list.
    await act(async () => {
      screen.getByRole("button", { name: /Back to inbox/ }).click();
    });
    expect(await screen.findByRole("button", { name: "Lunch?" })).toBeInTheDocument();
  });

  it("shows an unread indicator for unread messages only", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(INBOX)} />,
    );
    await screen.findByRole("button", { name: "Lunch?" });
    // m1 (Lunch?) is unread; m2 (Report) is read. The accessible status text
    // distinguishes them.
    expect(screen.getByText("Unread")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("shows the empty state for a mailbox with no messages", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(EMPTY)} />,
    );
    expect(await screen.findByText("No messages.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a login-flavoured access error (401) with NO retry button", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={statusFetch(401)} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("You need to log in");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a permission access error (403) with NO retry button", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={statusFetch(403)} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("don't have permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a generic error (404) WITH a working retry that re-fetches", async () => {
    let present = false;
    const fetch = (async () => {
      if (!present) {
        return new Response(null, { status: 404 });
      }
      return ttl(INBOX);
    }) as unknown as typeof globalThis.fetch;

    render(<Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={fetch} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    present = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByRole("button", { name: "Lunch?" })).toBeInTheDocument();
  });

  it("shows a loading status while the first request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async () => {
      await gate;
      return ttl(INBOX);
    }) as unknown as typeof globalThis.fetch;

    render(<Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: "Lunch?" })).toBeInTheDocument();
  });

  it("falls back to the global fetch when no fetch prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => ttl(INBOX)) as typeof fetch);
    render(<Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" />);
    expect(await screen.findByRole("button", { name: "Lunch?" })).toBeInTheDocument();
  });

  it("renders without a title heading when none is given", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(INBOX)} />,
    );
    await screen.findByRole("button", { name: "Lunch?" });
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders an http(s) WebID sender as a safe link", async () => {
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(INBOX)} />,
    );
    const open = await screen.findByRole("button", { name: "Report" });
    await act(async () => {
      open.click();
    });
    const link = screen.getByRole("link", { name: /bob\.example/ });
    expect(link).toHaveAttribute("href", "https://bob.example/profile/card#me");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does NOT make a javascript: sender into a link (XSS guard) and shows HTML body literally", async () => {
    // An untrusted message: a sender whose IRI carries a `javascript:` scheme
    // (valid RDF — a NamedNode), and an HTML-looking subject + body. The sender
    // must render as TEXT (no link/href, because safeHref rejects the scheme),
    // and the markup must appear literally (React escapes; no
    // dangerouslySetInnerHTML).
    const EVIL = `
@prefix schema: <http://schema.org/> .
<https://pod.example/mail/messages/evil.ttl#it> a schema:EmailMessage ;
  schema:headline "<img src=x onerror=alert(1)>" ;
  schema:sender <javascript:alert(document.cookie)> ;
  schema:text "<script>alert('xss')</script>" .
`;
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(EVIL)} />,
    );
    const open = await screen.findByRole("button", { name: /img src=x/ });
    await act(async () => {
      open.click();
    });

    const article = screen.getByRole("article", { name: "Message" });
    // No link was created for the unsafe sender; the value is shown as text.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(article).toHaveTextContent("javascript:alert(document.cookie)");
    // The HTML body is rendered literally, not as DOM (no <script> element).
    expect(article).toHaveTextContent("<script>alert('xss')</script>");
    expect(article.querySelector("script")).toBeNull();
    expect(article.querySelector("img")).toBeNull();
  });

  it("opens a bodyless / senderless message without crashing (fallbacks render)", async () => {
    // A bare message (no body, no sender, no date) must open cleanly: subject
    // fallback, "(unknown sender)", an em-dash date and an empty body pane.
    const BARE = `
@prefix schema: <http://schema.org/> .
<https://pod.example/mail/messages/bare.ttl#it> a schema:EmailMessage .
`;
    render(
      <Inbox mailboxUrl="https://pod.example/mail/folders/inbox.ttl" fetch={bodyFetch(BARE)} />,
    );
    const open = await screen.findByRole("button", { name: "(no subject)" });
    await act(async () => {
      open.click();
    });
    const article = screen.getByRole("article", { name: "Message" });
    expect(article).toHaveTextContent("(unknown sender)");
    expect(article).toHaveTextContent("—");
    // The body <pre> exists and is empty (the `?? ""` fallback).
    const body = article.querySelector(".pod-mail-body");
    expect(body).not.toBeNull();
    expect(body?.textContent).toBe("");
  });
});
