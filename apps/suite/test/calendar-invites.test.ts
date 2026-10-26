// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  type AttendeeSpec,
  applyReply,
  attendeeRoles,
  cancelInvitation,
  createInvitation,
  InvitationError,
  type InvitationErrorCode,
  type ParticipationStatus,
  participationStatuses,
  planInvite,
  planReply,
  type ReplyPlan,
  setAttendees,
  summarizeInvitation,
} from "../src/apps/calendar/lib/invites";

const organizer = "https://example.org/morgan#me";
const alex = "https://example.org/alex#me";
const robin = "https://example.org/robin#me";
const sam = "https://example.org/sam#me";
const stamp = "2026-10-26T10:00:00Z";
const later = "2026-10-26T10:00:01Z";
const earlier = "2026-10-26T09:59:59Z";
const members: readonly AttendeeSpec[] = [
  { webId: alex, role: "REQ-PARTICIPANT" },
  { webId: robin, role: "OPT-PARTICIPANT" },
];
const fresh = () =>
  createInvitation({ uid: "fictional-meeting@example.org", organizer, attendees: members });
const unsafe = <T>(value: unknown) => value as T;
function fails(run: () => unknown, code: InvitationErrorCode = "invalid-input") {
  expect(run).toThrow(InvitationError);
  expect(run).toThrow(expect.objectContaining({ name: "InvitationError", code }));
}

describe("calendar invitations", () => {
  it("creates explicit roles with all attendees initially needing action and sequence zero", () => {
    const state = fresh();
    expect(state).toEqual({
      uid: "fictional-meeting@example.org",
      organizer,
      sequence: 0,
      cancelled: false,
      attendees: members.map((member) => ({ ...member, status: "NEEDS-ACTION", repliedAt: null })),
    });
    for (const role of attendeeRoles) {
      expect(
        createInvitation({ uid: "roles", organizer, attendees: [{ webId: alex, role }] })
          .attendees[0]?.role,
      ).toBe(role);
    }
    expect(
      summarizeInvitation(createInvitation({ uid: "empty", organizer, attendees: [] })),
    ).toEqual({
      total: 0,
      counts: { "NEEDS-ACTION": 0, ACCEPTED: 0, DECLINED: 0, TENTATIVE: 0, DELEGATED: 0 },
    });
  });

  it("plans deterministic REQUESTs at the current sequence without altering state", () => {
    const state = fresh();
    const snapshot = structuredClone(state);
    const request = planInvite(state, organizer, stamp);
    expect(request).toEqual({
      uid: state.uid,
      organizer,
      sequence: 0,
      dtstamp: stamp,
      method: "REQUEST",
      from: organizer,
      to: [alex, robin],
      attendees: state.attendees,
    });
    expect(planInvite(state, organizer, stamp)).toEqual(request);
    expect(state).toEqual(snapshot);
    unsafe<{ status: string }>(request.attendees[0]).status = "DECLINED";
    expect(state.attendees[0]?.status).toBe("NEEDS-ACTION");
    fails(() => planInvite(state, alex, stamp), "forbidden");
  });

  it.each(participationStatuses)("allows an attendee to reply %s only for themselves", (status) => {
    const state = fresh();
    const reply = planReply(state, alex, status, stamp);
    expect(reply).toEqual({
      uid: state.uid,
      organizer,
      sequence: 0,
      dtstamp: stamp,
      method: "REPLY",
      from: alex,
      to: organizer,
      status,
    });
    const applied = applyReply(state, alex, reply);
    expect(applied.outcome).toBe("applied");
    expect(applied.state.attendees[0]).toEqual({ ...members[0], status, repliedAt: stamp });
    expect(applied.state.attendees[1]).toEqual(state.attendees[1]);
    expect(applied.state.sequence).toBe(0);
    expect(state.attendees[0]?.status).toBe("NEEDS-ACTION");
    fails(() => applyReply(state, robin, reply), "forbidden");
  });

  it("requires membership even for the organizer's own reply", () => {
    fails(() => planReply(fresh(), organizer, "ACCEPTED", stamp), "forbidden");
    const state = createInvitation({
      uid: "chair",
      organizer,
      attendees: [{ webId: organizer, role: "CHAIR" }],
    });
    expect(
      applyReply(state, organizer, planReply(state, organizer, "ACCEPTED", stamp)).outcome,
    ).toBe("applied");
    fails(
      () => applyReply(fresh(), sam, { ...planReply(fresh(), alex, "ACCEPTED", stamp), from: sam }),
      "forbidden",
    );
  });

  it("lets only the organizer change membership and roles while preserving RSVP", () => {
    const initial = fresh();
    const replied = applyReply(initial, alex, planReply(initial, alex, "ACCEPTED", stamp)).state;
    const updatedMembers: AttendeeSpec[] = [
      { webId: alex, role: "CHAIR" },
      { webId: sam, role: "NON-PARTICIPANT" },
    ];
    const change = setAttendees(replied, organizer, updatedMembers, later);
    expect(change.state.sequence).toBe(1);
    expect(change.state.attendees).toEqual([
      { webId: alex, role: "CHAIR", status: "ACCEPTED", repliedAt: null },
      { webId: sam, role: "NON-PARTICIPANT", status: "NEEDS-ACTION", repliedAt: null },
    ]);
    expect(change.messages).toEqual([
      {
        uid: initial.uid,
        organizer,
        sequence: 1,
        dtstamp: later,
        method: "CANCEL",
        from: organizer,
        to: [robin],
      },
      planInvite(change.state, organizer, later),
    ]);
    expect(replied.attendees[0]?.repliedAt).toBe(stamp);
    fails(() => setAttendees(replied, alex, updatedMembers, later), "forbidden");
    fails(() =>
      setAttendees(replied, organizer, unsafe([{ ...members[0], status: "DECLINED" }]), later),
    );
    // Explicit reissue, including unchanged membership, advances sequence.
    expect(setAttendees(initial, organizer, members, stamp).messages.map((m) => m.method)).toEqual([
      "REQUEST",
    ]);
    const removed = setAttendees(initial, organizer, [], stamp);
    expect(removed.messages).toHaveLength(1);
    expect(removed.messages[0]).toMatchObject({ method: "CANCEL", to: [alex, robin] });
    const empty = createInvitation({ uid: "empty", organizer, attendees: [] });
    expect(setAttendees(empty, organizer, [], stamp).messages).toEqual([]);
  });

  it("ignores old sequences including removed attendees and rejects future sequences", () => {
    const initial = fresh();
    const reply = planReply(initial, robin, "TENTATIVE", stamp);
    const updated = setAttendees(initial, organizer, [members[0] as AttendeeSpec], later).state;
    expect(applyReply(updated, robin, reply)).toEqual({ state: updated, outcome: "ignored-stale" });
    fails(() => applyReply(initial, robin, { ...reply, sequence: 1 }), "future-reply");
    fails(() => applyReply(updated, robin, { ...reply, sequence: 1 }), "forbidden");
    expect(applyReply(updated, alex, planReply(updated, alex, "ACCEPTED", stamp)).outcome).toBe(
      "applied",
    );
  });

  it("orders same-sequence replies by DTSTAMP, ignoring duplicates and older conflicting replies", () => {
    const initial = fresh();
    const reply = planReply(initial, alex, "ACCEPTED", stamp);
    const state = applyReply(initial, alex, reply).state;
    expect(applyReply(state, alex, reply)).toEqual({ state, outcome: "ignored-stale" });
    expect(
      applyReply(state, alex, { ...reply, dtstamp: earlier, status: "DECLINED" }).outcome,
    ).toBe("ignored-stale");
    expect(applyReply(state, alex, { ...reply, status: "DECLINED" }).outcome).toBe("ignored-stale");
    const result = applyReply(state, alex, { ...reply, dtstamp: later, status: "DECLINED" });
    expect(result.state.attendees[0]?.status).toBe("DECLINED");
    expect(result.state.attendees[0]?.repliedAt).toBe(later);
  });

  it.each(["uid", "organizer", "to"] as const)("rejects replies with a mismatched %s", (key) => {
    const state = fresh();
    fails(
      () => applyReply(state, alex, { ...planReply(state, alex, "ACCEPTED", stamp), [key]: sam }),
      "event-mismatch",
    );
  });

  it("cancels only as organizer, increments sequence, and prevents resurrection", () => {
    const state = fresh();
    fails(() => cancelInvitation(state, alex, stamp), "forbidden");
    const cancellation = cancelInvitation(state, organizer, stamp);
    expect(cancellation.state).toEqual({ ...state, sequence: 1, cancelled: true });
    expect(cancellation.messages).toEqual([
      {
        uid: state.uid,
        organizer,
        sequence: 1,
        dtstamp: stamp,
        method: "CANCEL",
        from: organizer,
        to: [alex, robin],
      },
    ]);
    const cancelled = cancellation.state;
    fails(() => planInvite(cancelled, organizer, stamp), "cancelled");
    fails(() => planReply(cancelled, alex, "ACCEPTED", stamp), "cancelled");
    fails(() => setAttendees(cancelled, organizer, members, stamp), "cancelled");
    fails(() => cancelInvitation(cancelled, organizer, stamp), "cancelled");
    const reply = planReply(state, alex, "ACCEPTED", stamp);
    expect(applyReply(cancelled, alex, reply).outcome).toBe("ignored-stale");
    fails(() => applyReply(cancelled, alex, { ...reply, sequence: 1 }), "cancelled");
    expect(summarizeInvitation(cancelled).total).toBe(2);
    expect(state.cancelled).toBe(false);
    expect(
      cancelInvitation(
        createInvitation({ uid: "empty", organizer, attendees: [] }),
        organizer,
        stamp,
      ).messages[0],
    ).toMatchObject({ to: [] });
  });

  it("summarizes each status, including multiple people per status", () => {
    const state = createInvitation({
      uid: "summary",
      organizer,
      attendees: [...participationStatuses, "ACCEPTED"].map((_, i) => ({
        webId: `https://example.org/person-${i}#me`,
        role: "REQ-PARTICIPANT",
      })),
    });
    let result = state;
    [...participationStatuses, "ACCEPTED" as const].forEach((status, i) => {
      const actor = state.attendees[i]?.webId as string;
      result = applyReply(result, actor, planReply(result, actor, status, stamp)).state;
    });
    expect(summarizeInvitation(result)).toEqual({
      total: 6,
      counts: {
        "NEEDS-ACTION": 1,
        ACCEPTED: 2,
        DECLINED: 1,
        TENTATIVE: 1,
        DELEGATED: 1,
      },
    });
  });
});

describe("fail-closed invitation inputs", () => {
  it.each([
    null,
    undefined,
    false,
    2,
    "input",
    [],
    new Date(),
    {},
    { uid: "x" },
    { uid: "x", organizer, attendees: [], recurrenceId: "2026-10-26" },
    { uid: "x", organizer, wrong: [] },
    { uid: "x", organizer, attendees: [], [Symbol("extension")]: true },
  ])("rejects malformed object shape %#", (input) => {
    fails(() => createInvitation(unsafe(input)));
  });

  it.each([
    undefined,
    1,
    "",
    " ",
    " event",
    "event ",
    "event\nname",
    "event\u007f",
  ])("rejects invalid UID %#", (uid) => {
    fails(() => createInvitation(unsafe({ uid, organizer, attendees: [] })));
  });

  it.each([
    "relative",
    "mailto:alex@example.org",
    "ftp://example.org/",
    "https://user@example.org/",
    "https://user:password@example.org/",
    "https://EXAMPLE.org/",
    "https://example.org",
    "https://example.org/a b",
  ])("rejects unsupported/noncanonical identity %#", (webId) => {
    fails(
      () => createInvitation({ uid: "x", organizer: webId, attendees: [] }),
      "invalid-identity",
    );
  });

  it("accepts canonical HTTP identities without silently rewriting them", () => {
    expect(
      createInvitation({ uid: "http", organizer: "http://example.org/#me", attendees: [] })
        .organizer,
    ).toBe("http://example.org/#me");
    fails(() => planInvite(fresh(), unsafe(null), stamp));
  });

  it.each([
    null,
    {},
    [null],
    [false],
    [members[0], members[0]],
    [{ webId: alex, role: "OWNER" }],
    [{ webId: alex }],
    [{ webId: alex, role: "CHAIR", delegatedTo: robin }],
    Array(1),
  ])("rejects invalid or ambiguous attendee lists %#", (attendees) => {
    fails(() => createInvitation(unsafe({ uid: "x", organizer, attendees })));
  });

  it.each([
    -1,
    0.1,
    NaN,
    Infinity,
    2_147_483_648,
    "0",
    null,
    undefined,
  ])("rejects invalid sequence %#", (sequence) => {
    fails(() => summarizeInvitation(unsafe({ ...fresh(), sequence })), "invalid-sequence");
  });

  it("rejects sequence overflow on either organizer mutation", () => {
    const state = { ...fresh(), sequence: 2_147_483_647 };
    expect(planInvite(state, organizer, stamp).sequence).toBe(2_147_483_647);
    fails(() => setAttendees(state, organizer, members, stamp), "invalid-sequence");
    fails(() => cancelInvitation(state, organizer, stamp), "invalid-sequence");
  });

  it.each([
    null,
    undefined,
    123,
    "",
    "2026-02-30T10:00:00Z",
    "2026-13-01T10:00:00Z",
    "2026-10-26T24:00:00Z",
    "0000-01-01T00:00:00Z",
    "2026-10-26T10:00:00.000Z",
    "2026-10-26T10:00:00+00:00",
  ])("rejects invalid or unsupported DTSTAMP %#", (dtstamp) => {
    fails(() => planInvite(fresh(), organizer, unsafe(dtstamp)), "invalid-timestamp");
  });

  it("validates imported state, persisted reply stamps, and status values", () => {
    fails(() => summarizeInvitation(unsafe(null)));
    fails(() => summarizeInvitation(unsafe({ ...fresh(), cancelled: "false" })));
    fails(() =>
      summarizeInvitation(
        unsafe({ ...fresh(), attendees: [{ ...fresh().attendees[0], status: "UNKNOWN" }] }),
      ),
    );
    fails(
      () =>
        summarizeInvitation(
          unsafe({ ...fresh(), attendees: [{ ...fresh().attendees[0], repliedAt: "yesterday" }] }),
        ),
      "invalid-timestamp",
    );
    fails(() => planReply(fresh(), alex, unsafe("COMPLETED"), stamp));
    fails(() => planReply(fresh(), alex, unsafe(null), stamp));
  });

  it("validates replies completely before classifying stale input", () => {
    const state = fresh();
    const reply = planReply(state, alex, "ACCEPTED", stamp);
    const malformed: [unknown, InvitationErrorCode][] = [
      [null, "invalid-input"],
      [{ ...reply, method: "REQUEST" }, "invalid-input"],
      [{ ...reply, role: "CHAIR" }, "invalid-input"],
      [{ ...reply, sequence: -1 }, "invalid-sequence"],
      [{ ...reply, from: "relative" }, "invalid-identity"],
      [{ ...reply, organizer: "relative" }, "invalid-identity"],
      [{ ...reply, to: "relative" }, "invalid-identity"],
      [{ ...reply, status: "COMPLETED" }, "invalid-input"],
      [{ ...reply, dtstamp: "invalid" }, "invalid-timestamp"],
    ];
    for (const [input, code] of malformed)
      fails(() => applyReply(state, alex, unsafe<ReplyPlan>(input)), code);
    const updated = setAttendees(state, organizer, members, later).state;
    fails(() => applyReply(updated, robin, reply), "forbidden");
    fails(() => applyReply(updated, alex, { ...reply, uid: "other" }), "event-mismatch");
  });

  it("returns data independent of inputs even when a stale reply is ignored", () => {
    const state = fresh();
    const original = structuredClone(state);
    const reply = planReply(state, alex, "ACCEPTED", stamp);
    const updated = setAttendees(state, organizer, members, later).state;
    const result = applyReply(updated, alex, reply);
    unsafe<{ status: ParticipationStatus }>(result.state.attendees[0]).status = "DECLINED";
    expect(updated.attendees[0]?.status).toBe("NEEDS-ACTION");
    expect(state).toEqual(original);
    expect(new InvitationError("forbidden").message).toBe("Calendar invitations: forbidden");
  });
});
