// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The chat VIEW + its data hook, driven by a stubbed authenticated fetch (the
// auth seam). Proves the view renders a real rooms container (parsed by the data
// layer), opens a room's thread and returns to the list, renders the actionable
// task badge + assignee, the empty / loading / error / access-denied states,
// and — critically — renders UNTRUSTED chat content defensively (no HTML
// injection, no unsafe author link). All with NO real pod and NO login flow.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatRooms } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const POD = "https://pod.example/";
const WEBID = "https://pod.example/profile/card#me";
const ROOMS = "https://pod.example/pod-chat/rooms/";
const MESSAGES = "https://pod.example/pod-chat/messages/";
const ROOM_A = `${ROOMS}general-aaa.ttl`;
const MSG_1 = `${MESSAGES}msg-1.ttl`;
const MSG_2 = `${MESSAGES}msg-2.ttl`;

function containerTtl(container: string, members: string[]): string {
  const contains = members.map((m) => `<${m}>`).join(", ");
  return `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${container}> a ldp:Container, ldp:BasicContainer${
    members.length > 0 ? ` ;\n  ldp:contains ${contains}` : ""
  } .
${members.map((m) => `<${m}> a ldp:Resource .`).join("\n")}
`;
}

function roomTtl(url: string, name: string, creator: string, refs: string[]): string {
  const items = refs.map((r) => `<${r}>`).join(", ");
  return `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix pc: <https://w3id.org/jeswr/pod-chat#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${url}#it> a as:Collection, pc:ChatRoom ;
  as:name "${name}" ;
  dct:creator <${creator}> ;
  dct:created "2026-06-10T09:00:00Z"^^xsd:dateTime${
    refs.length > 0 ? ` ;\n  as:items ${items}` : ""
  } .
`;
}

function ttl(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/turtle", etag: '"v1"' },
  });
}

/** A one-room pod: ROOM_A has a plain message (MSG_1) + an actionable task (MSG_2). */
function podFetch(): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
    if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [MSG_1, MSG_2]));
    if (url === MSG_1) {
      return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${MSG_1}#it> a as:Note ;
  as:content "Line one.\\nLine two." ;
  as:attributedTo <https://alice.example/profile/card#me> ;
  as:published "2026-06-10T10:00:00Z"^^xsd:dateTime .
`);
    }
    if (url === MSG_2) {
      return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${MSG_2}#it> a as:Note, wf:Task, wf:Open ;
  as:content "could you review the PR?" ;
  as:attributedTo <https://bob.example/profile/card#me> ;
  dct:title "Review PR" ;
  wf:assignee <https://carol.example/profile/card#me> ;
  as:published "2026-06-10T11:00:00Z"^^xsd:dateTime .
`);
    }
    if (url === MESSAGES) return ttl(containerTtl(MESSAGES, []));
    return new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
}

function statusFetch(status: number): typeof globalThis.fetch {
  return (async () => new Response(null, { status })) as unknown as typeof globalThis.fetch;
}

describe("ChatRooms", () => {
  it("renders the room list with name / creator / created / message count", async () => {
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={podFetch()} title="Chat" />);
    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
    const open = await screen.findByRole("button", { name: "General" });
    const row = open.closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("2026-06-10 09:00");
    expect(row).toHaveTextContent("pod.example"); // creator WebID
    expect(row).toHaveTextContent("2"); // message count
  });

  it("opens a room's thread (messages chronological) and returns via Back", async () => {
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={podFetch()} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    // Both messages present, oldest-first.
    const items = thread.querySelectorAll(".pod-chat-message");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Line one.");
    expect(items[1]).toHaveTextContent("could you review the PR?");

    // Back returns to the list.
    await act(async () => {
      screen.getByRole("button", { name: /Back to rooms/ }).click();
    });
    expect(await screen.findByRole("button", { name: "General" })).toBeInTheDocument();
  });

  it("renders the actionable-task badge + assignee for a task message", async () => {
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={podFetch()} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    expect(thread).toHaveTextContent("Task: Review PR");
    expect(thread).toHaveTextContent("Assigned to:");
    // The assignee is an http(s) WebID → a safe link.
    const link = screen.getByRole("link", { name: /carol\.example/ });
    expect(link).toHaveAttribute("href", "https://carol.example/profile/card#me");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a CLOSED task badge with no title (closed branch + empty title)", async () => {
    const Task = `${MESSAGES}closed.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [Task]));
      if (url === Task) {
        // A closed task with NO dct:title and NO assignee — exercises the closed
        // badge branch and the empty-title branch.
        return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
<${Task}#it> a as:Note, wf:Task, wf:Closed ;
  as:content "done" .
`);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    const badge = thread.querySelector(".pod-chat-task-closed");
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("data-task-state", "closed");
    // No "Task:" title suffix (the empty-title branch) and no assignee line.
    expect(thread.textContent).toContain("Task");
    expect(thread.textContent).not.toContain("Task:");
    expect(thread).not.toHaveTextContent("Assigned to:");
  });

  it("renders a thread access error (403 on a message read) with NO retry button", async () => {
    const Evil = `${MESSAGES}forbidden.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [Evil]));
      if (url === Evil) return new Response(null, { status: 403 });
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows the empty state when the pod has no rooms", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(await screen.findByText("No rooms.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders a generic room-list error (500 on the container) WITH a working retry", async () => {
    // A 500 on the rooms container is a non-access error: the list shows a Retry.
    let healed = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) {
        if (!healed) return new Response(null, { status: 500 });
        return ttl(containerTtl(ROOMS, []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    healed = true;
    await act(async () => {
      retry.click();
    });
    expect(await screen.findByText("No rooms.")).toBeInTheDocument();
  });

  it("shows an empty thread for a room with no messages", async () => {
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "Empty", WEBID, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "Empty" });
    await act(async () => {
      open.click();
    });
    expect(await screen.findByText("No messages.")).toBeInTheDocument();
  });

  it("renders a login-flavoured access error (401) with NO retry button", async () => {
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={statusFetch(401)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("log in");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a permission access error (403 on a room read) with NO retry button", async () => {
    // The container lists a room, but reading that room is forbidden (403). The
    // data layer swallows a 403 on the CONTAINER itself (→ empty list), so a
    // permission wall surfaces via the per-room read, which is re-thrown as a
    // list-level access error.
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return new Response(null, { status: 403 });
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a generic thread error (a message read fails) WITH a working retry", async () => {
    // The room lists + opens fine, but a referenced message read 500s → the
    // thread surfaces a generic (non-access) error with a Retry; once the
    // message read succeeds, the thread renders.
    let healed = false;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [MSG_1]));
      if (url === MSG_1) {
        if (!healed) return new Response(null, { status: 500 });
        return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
<${MSG_1}#it> a as:Note ; as:content "recovered" .
`);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    healed = true;
    await act(async () => {
      retry.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    expect(thread).toHaveTextContent("recovered");
  });

  it("shows a loading status while the first room-list request is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) {
        await gate;
        return ttl(containerTtl(ROOMS, []));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(await screen.findByText("No rooms.")).toBeInTheDocument();
  });

  it("falls back to the global fetch when no fetch prop is given", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(podFetch() as typeof fetch);
    render(<ChatRooms podRoot={POD} webId={WEBID} />);
    expect(await screen.findByRole("button", { name: "General" })).toBeInTheDocument();
  });

  it("renders without a title heading when none is given", async () => {
    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={podFetch()} />);
    await screen.findByRole("button", { name: "General" });
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("does NOT make a javascript: author into a link (XSS guard) and shows HTML body literally", async () => {
    // An untrusted message: an author whose IRI carries a `javascript:` scheme
    // (valid RDF — a NamedNode), and an HTML-looking body. The author must
    // render as TEXT (no link, because safeHref rejects the scheme), and the
    // markup must appear literally (React escapes; no dangerouslySetInnerHTML).
    const EvilMsg = `${MESSAGES}evil.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A)
        return ttl(roomTtl(ROOM_A, "<img src=x onerror=alert(1)>", WEBID, [EvilMsg]));
      if (url === EvilMsg) {
        return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
<${EvilMsg}#it> a as:Note ;
  as:content "<script>alert('xss')</script>" ;
  as:attributedTo <javascript:alert(document.cookie)> .
`);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    // The room name (untrusted HTML) is shown literally as the button label.
    const open = await screen.findByRole("button", { name: /img src=x/ });
    await act(async () => {
      open.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    // No link was created for the unsafe author; the value is shown as text.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(thread).toHaveTextContent("javascript:alert(document.cookie)");
    // The HTML body is rendered literally, not as DOM (no <script> element).
    expect(thread).toHaveTextContent("<script>alert('xss')</script>");
    expect(thread.querySelector("script")).toBeNull();
    expect(thread.querySelector("img")).toBeNull();
  });

  it("composes a message: optimistic render, persisted, Saved, input cleared", async () => {
    // A writable one-room pod (ROOM_A starts empty). Container PUTs answer 412;
    // a message PUT under MESSAGES is accepted + recorded; the room PUT (append)
    // succeeds. Reads reflect the appended message.
    const refs: string[] = [];
    let postedUrl: string | null = null;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        if (url.startsWith(MESSAGES)) {
          postedUrl = url;
          refs.push(url);
          return new Response(null, { status: 201, headers: { etag: '"w1"' } });
        }
        if (url === ROOM_A) return new Response(null, { status: 200, headers: { etag: '"r2"' } });
        return new Response(null, { status: 404 });
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, refs));
      if (postedUrl !== null && url === postedUrl) {
        return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${postedUrl}#it> a as:Note ;
  as:content "Hello team" ;
  as:attributedTo <${WEBID}> ;
  as:published "2026-06-12T12:00:00Z"^^xsd:dateTime .
`);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    await screen.findByRole("region", { name: "Room" });
    expect(screen.getByText("No messages.")).toBeInTheDocument();

    const input = screen.getByLabelText("Message");
    const sendBtn = screen.getByRole("button", { name: "Send" });
    // Empty input → Send disabled.
    expect(sendBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "Hello team" } });
    expect(sendBtn).not.toBeDisabled();
    await act(async () => {
      sendBtn.click();
    });

    // The message persisted, the Saved cue shows, and the input was cleared.
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    const thread = screen.getByRole("region", { name: "Room" });
    expect(thread).toHaveTextContent("Hello team");
    expect((input as HTMLInputElement).value).toBe("");
    expect(refs).toHaveLength(1);
  });

  it("reverts the optimistic message and shows an error when the send fails", async () => {
    // The message-resource PUT 500s → the optimistic message is removed and a
    // send error is surfaced; the input text is KEPT for a retry.
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        if (url === ROOMS || url === MESSAGES || url === "https://pod.example/pod-chat/") {
          return new Response(null, { status: 412 });
        }
        if (url.startsWith(MESSAGES)) return new Response(null, { status: 500 });
        return new Response(null, { status: 404 });
      }
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    await screen.findByRole("region", { name: "Room" });

    const input = screen.getByLabelText("Message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "will fail" } });
    await act(async () => {
      screen.getByRole("button", { name: "Send" }).click();
    });

    // The send-error alert shows and the optimistic message was reverted (the
    // thread is back to empty — "No messages.").
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.className.includes("pod-chat-send-error"))).toBe(true);
    expect(screen.getByText("No messages.")).toBeInTheDocument();
    // The text is kept so the user can retry without retyping.
    expect(input.value).toBe("will fail");
  });

  it("does not send an empty / whitespace body (Send stays disabled)", async () => {
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") return new Response(null, { status: 500 }); // any write is a failure we must NOT trigger
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, []));
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    await screen.findByRole("region", { name: "Room" });
    const input = screen.getByLabelText("Message");
    const sendBtn = screen.getByRole("button", { name: "Send" });
    expect(sendBtn).toBeDisabled();
    // Whitespace-only is still "nothing to send".
    fireEvent.change(input, { target: { value: "   " } });
    expect(sendBtn).toBeDisabled();
    // Submitting the form anyway (e.g. Enter) is a no-op — the composer's own
    // `!canSend` guard short-circuits before any write fires.
    const form = screen.getByRole("form", { name: "Send a message" });
    await act(async () => {
      fireEvent.submit(form);
    });
    // No status cue ever appears and no write was attempted.
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't send")).not.toBeInTheDocument();
  });

  it("does NOT render the composer when the thread is access-walled (403 thread)", async () => {
    const Evil = `${MESSAGES}forbidden.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [Evil]));
      if (url === Evil) return new Response(null, { status: 403 });
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("permission");
    // No composer form when the thread can't be read.
    expect(screen.queryByRole("form", { name: "Send a message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("opens a contentless / authorless message without crashing (fallbacks render)", async () => {
    const Bare = `${MESSAGES}bare.ttl`;
    const fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === ROOMS) return ttl(containerTtl(ROOMS, [ROOM_A]));
      if (url === ROOM_A) return ttl(roomTtl(ROOM_A, "General", WEBID, [Bare]));
      if (url === Bare) {
        return ttl(`
@prefix as: <https://www.w3.org/ns/activitystreams#> .
<${Bare}#it> a as:Note .
`);
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    render(<ChatRooms podRoot={POD} webId={WEBID} fetch={fetch} />);
    const open = await screen.findByRole("button", { name: "General" });
    await act(async () => {
      open.click();
    });
    const thread = await screen.findByRole("region", { name: "Room" });
    expect(thread).toHaveTextContent("(unknown sender)");
    expect(thread).toHaveTextContent("(no content)");
    expect(thread).toHaveTextContent("—"); // em-dash for the missing date
  });
});
