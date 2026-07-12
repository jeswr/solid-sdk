// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import {
  AS,
  AS_CLASS,
  CHAT_ROOM_CLASS,
  DCT,
  DEFAULT_MEDIA_TYPE,
  NS,
  PC,
  PREFIXES,
  RDF_TYPE,
  WF,
  WF_CLASS,
} from "./vocab.js";

describe("vocab", () => {
  it("composes IRIs from their namespaces", () => {
    expect(RDF_TYPE).toBe(`${NS.RDF}type`);
    expect(CHAT_ROOM_CLASS).toBe(`${NS.PC}ChatRoom`);
    expect(PC.participant).toBe(`${NS.PC}participant`);
  });

  it("uses ActivityStreams 2.0 for the chat classes + predicates", () => {
    expect(AS_CLASS.Collection).toBe("https://www.w3.org/ns/activitystreams#Collection");
    expect(AS_CLASS.Note).toBe("https://www.w3.org/ns/activitystreams#Note");
    expect(AS_CLASS.Person).toBe("https://www.w3.org/ns/activitystreams#Person");
    expect(AS.content).toBe("https://www.w3.org/ns/activitystreams#content");
    expect(AS.attributedTo).toBe("https://www.w3.org/ns/activitystreams#attributedTo");
    expect(AS.published).toBe("https://www.w3.org/ns/activitystreams#published");
    expect(AS.context).toBe("https://www.w3.org/ns/activitystreams#context");
    expect(AS.inReplyTo).toBe("https://www.w3.org/ns/activitystreams#inReplyTo");
    expect(AS.items).toBe("https://www.w3.org/ns/activitystreams#items");
    expect(AS.mediaType).toBe("https://www.w3.org/ns/activitystreams#mediaType");
    expect(AS.name).toBe("https://www.w3.org/ns/activitystreams#name");
  });

  it("uses the shared cross-app task model (wf:/dct:) for actionable messages", () => {
    expect(WF_CLASS.Task).toBe("http://www.w3.org/2005/01/wf/flow#Task");
    expect(WF_CLASS.Open).toBe("http://www.w3.org/2005/01/wf/flow#Open");
    expect(WF_CLASS.Closed).toBe("http://www.w3.org/2005/01/wf/flow#Closed");
    expect(WF.assignee).toBe("http://www.w3.org/2005/01/wf/flow#assignee");
    expect(DCT.title).toBe("http://purl.org/dc/terms/title");
    expect(DCT.created).toBe("http://purl.org/dc/terms/created");
    expect(DCT.creator).toBe("http://purl.org/dc/terms/creator");
  });

  it("defaults the message body media type to text/plain", () => {
    expect(DEFAULT_MEDIA_TYPE).toBe("text/plain");
  });

  it("exposes a Turtle prefix map covering every namespace it writes", () => {
    expect(PREFIXES.pc).toBe(NS.PC);
    expect(PREFIXES.as).toBe(NS.AS);
    expect(PREFIXES.wf).toBe(NS.WF);
    expect(PREFIXES.dct).toBe(NS.DCT);
    expect(PREFIXES.xsd).toBe(NS.XSD);
  });
});
