// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { NamedNodeFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { IssueAssignmentAnnouncer, issuesStore, type Issue } from "./issues.js";
import { ActivityDoc } from "./notify-send.js";
import { serializeTurtle } from "./pod-data.js";
import {
  InvalidTargetError,
  NoInboxError,
  NotificationSendError,
  ResourceWriteError,
} from "./errors.js";
import type { StoredItem } from "./productivity-store.js";

const ACTOR = "https://alice.example/profile/card#me";
const RECIPIENT = "https://bob.example/profile/card#me";
const PROFILE = "https://bob.example/profile/card";
const INBOX = "https://bob.example/inbox/";
const POD = "https://alice.example/";
const ISSUE = `${POD}issues/repair.ttl`;
const AS = "https://www.w3.org/ns/activitystreams#";

class InboxProfile extends TermWrapper {
  set inbox(value: string | undefined) {
    OptionalAs.object(this, "http://www.w3.org/ns/ldp#inbox", value, NamedNodeFrom.string);
  }
}

function turtle(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/turtle", etag: '"v2"' } });
}

function previous(assignee?: string, url = ISSUE): StoredItem<Issue> {
  return { url, etag: '"v1"', data: { title: "Repair a hinge", state: "open", assignee } };
}

async function harness(opts: { inbox?: string; postStatus?: number; putStatus?: number } = {}) {
  const dataset = new Store();
  new InboxProfile(RECIPIENT, dataset, DataFactory).inbox = (opts.inbox ?? INBOX) || undefined;
  const profile = await serializeTurtle(dataset);
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith(`${POD}issues/`) && init?.method === "PUT") {
      return new Response(null, { status: opts.putStatus ?? 205, headers: { etag: '"v2"' } });
    }
    if (url === PROFILE) return turtle(profile);
    if (url === INBOX && init?.method === "POST") {
      return new Response(null, { status: opts.postStatus ?? 201 });
    }
    throw new Error("Unexpected mocked request");
  });
  const onError = vi.fn();
  const announcer = new IssueAssignmentAnnouncer({ actorWebId: ACTOR, fetchImpl, onError });
  const store = issuesStore({ podRoot: POD, webId: ACTOR, fetchImpl });
  const posts = () => fetchImpl.mock.calls.filter(([, init]) => init?.method === "POST");
  return { fetchImpl, onError, announcer, store, posts, profile };
}

describe("user issue assignment announcements", () => {
  it("saves first and announces only the issue IRI, actor, assignee and title", async () => {
    const h = await harness();
    const issue: Issue = {
      ...previous().data,
      title: 'Repair "a hinge"',
      description: `Private details at ${POD}private/notes.ttl`,
      assignee: RECIPIENT,
    };
    await expect(
      h.announcer.updateFromUser(h.store, previous(ACTOR), issue),
    ).resolves.toEqual({ etag: '"v2"' });
    await vi.waitFor(() => expect(h.posts()).toHaveLength(1));
    const [input, init] = h.posts()[0];
    expect(String(input)).toBe(INBOX);
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("content-type")).toBe("text/turtle");
    expect(h.fetchImpl.mock.calls[0][1]?.method).toBe("PUT");
    expect(new Headers(h.fetchImpl.mock.calls[0][1]?.headers).get("if-match")).toBe('"v1"');
    const { dataset } = await fetchRdf(`${INBOX}notification.ttl`, {
      fetch: vi.fn<typeof fetch>(async () => turtle(String(init?.body))),
    });
    const activity = new ActivityDoc(`${INBOX}notification.ttl#it`, dataset, DataFactory);
    expect([...activity.types]).toEqual([`${AS}Announce`]);
    expect(activity.actor).toBe(ACTOR);
    expect(activity.activityObject).toBe(`${ISSUE}#it`);
    expect(activity.target).toBe(RECIPIENT);
    expect(activity.summary).toBe('You were assigned to "Repair "a hinge""');
    expect(activity.content).toBeUndefined();
    expect(activity.published).toBeInstanceOf(Date);
    expect(dataset.size).toBe(6);
    expect(String(init?.body)).not.toContain(issue.description);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it.each([
    { name: "unchanged assignee", before: RECIPIENT, after: RECIPIENT },
    { name: "self-assignment", before: undefined, after: ACTOR },
    { name: "clearing", before: RECIPIENT, after: undefined },
    { name: "empty assignee", before: RECIPIENT, after: "" },
    { name: "invalid WebID", before: undefined, after: "not a WebID" },
  ])("keeps $name silent", async ({ before, after }) => {
    const h = await harness();
    await h.announcer.updateFromUser(h.store, previous(before), {
      ...previous().data, assignee: after,
    });
    expect(h.fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT"]);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("de-duplicates an issue/assignee pair even after clearing and reassigning", async () => {
    const h = await harness();
    const assigned = { ...previous().data, assignee: RECIPIENT };
    await h.announcer.updateFromUser(h.store, previous(), assigned);
    await vi.waitFor(() => expect(h.posts()).toHaveLength(1));
    await h.announcer.updateFromUser(h.store, previous(RECIPIENT), previous().data);
    await h.announcer.updateFromUser(h.store, previous(), assigned);
    expect(h.posts()).toHaveLength(1);
    expect(h.fetchImpl.mock.calls.filter(([url]) => String(url) === PROFILE)).toHaveLength(1);
  });

  it("reserves the pair while inbox delivery is still pending", async () => {
    const h = await harness();
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    h.fetchImpl.mockImplementationOnce(async () => new Response(null, { status: 205 }));
    h.fetchImpl.mockImplementationOnce(() => pending);
    const issue = { ...previous().data, assignee: RECIPIENT };
    await h.announcer.updateFromUser(h.store, previous(), issue);
    await h.announcer.updateFromUser(h.store, previous(), issue);
    expect(h.fetchImpl.mock.calls.filter(([url]) => String(url) === PROFILE)).toHaveLength(1);
    release(turtle(h.profile));
    await vi.waitFor(() => expect(h.posts()).toHaveLength(1));
  });

  it("announces the same assignee for a different issue", async () => {
    const h = await harness();
    const issue = { ...previous().data, assignee: RECIPIENT };
    await h.announcer.updateFromUser(h.store, previous(), issue);
    await h.announcer.updateFromUser(h.store, previous(undefined, `${POD}issues/other.ttl`), issue);
    await vi.waitFor(() => expect(h.posts()).toHaveLength(2));
  });

  it("does not fail the edit when POST fails and reports the failure", async () => {
    const h = await harness({ postStatus: 403 });
    await expect(h.announcer.updateFromUser(h.store, previous(), {
      ...previous().data, assignee: RECIPIENT,
    })).resolves.toEqual({ etag: '"v2"' });
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith(
      "Couldn't notify the assignee.", expect.any(NotificationSendError),
    ));
    expect(h.posts()).toHaveLength(1);
  });

  it("allows a later assignment transition to retry failed delivery", async () => {
    const h = await harness({ postStatus: 403 });
    const assigned = { ...previous().data, assignee: RECIPIENT };
    await h.announcer.updateFromUser(h.store, previous(), assigned);
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledTimes(1));
    await h.announcer.updateFromUser(h.store, previous(RECIPIENT), previous().data);
    await h.announcer.updateFromUser(h.store, previous(), assigned);
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledTimes(2));
    expect(h.posts()).toHaveLength(2);
  });

  it("contains a throwing error hook without failing the edit", async () => {
    const h = await harness({ postStatus: 403 });
    h.onError.mockImplementation(() => { throw new Error("Reporting failed"); });
    await expect(h.announcer.updateFromUser(h.store, previous(), {
      ...previous().data, assignee: RECIPIENT,
    })).resolves.toEqual({ etag: '"v2"' });
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled());
  });

  it.each([
    { name: "unsafe inbox", inbox: "https://169.254.169.254/inbox/", error: InvalidTargetError },
    { name: "missing inbox", inbox: "", error: NoInboxError },
  ])("sends nothing after $name discovery refusal", async ({ inbox, error }) => {
    const h = await harness({ inbox });
    await expect(h.announcer.updateFromUser(h.store, previous(), {
      ...previous().data, assignee: RECIPIENT,
    })).resolves.toEqual({ etag: '"v2"' });
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith(
      "Couldn't notify the assignee.", expect.any(error),
    ));
    expect(h.posts()).toHaveLength(0);
  });

  it("does not fetch an unsafe assignee profile", async () => {
    const h = await harness();
    await h.announcer.updateFromUser(h.store, previous(), {
      ...previous().data, assignee: "https://127.0.0.1/profile#me",
    });
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalled());
    expect(h.fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT"]);
  });

  it("does not announce a rejected issue write", async () => {
    const h = await harness({ putStatus: 412 });
    await expect(h.announcer.updateFromUser(h.store, previous(), {
      ...previous().data, assignee: RECIPIENT,
    })).rejects.toBeInstanceOf(ResourceWriteError);
    expect(h.fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT"]);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("keeps ordinary store updates silent for bulk and automated callers", async () => {
    const h = await harness();
    await h.store.update(ISSUE, { ...previous().data, assignee: RECIPIENT }, '"v1"');
    expect(h.fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["PUT"]);
  });
});
