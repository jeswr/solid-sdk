// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { serializeTurtle } from "./activity.js";
import { parseTask, writeTask } from "./task.js";

const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const BOB = "https://bob.example/card#me";
const TASK_IRI = "https://alice.example/tasks/42#it";

describe("task vocabulary compatibility", () => {
  it.each([
    ["https://w3id.org/jeswr/task"],
    ["https://jeswr.org/ns/task#"],
    ["https://w3id.org/jeswr/task", "https://jeswr.org/ns/task#"],
  ])("reads standard task data with vocabulary references %s", async (...vocabularies) => {
    const references = vocabularies.map((iri) => `<${iri}>`).join(", ");
    const dataset = await parseRdf(
      `
      <${TASK_IRI}> a <${WF}Task>, <${WF}Open> ;
        <${DCT}title> "Review" ; <${WF}assignee> <${BOB}> ;
        <http://www.w3.org/2000/01/rdf-schema#seeAlso> ${references} .`,
      "text/turtle",
      {},
    );
    const task = parseTask(TASK_IRI, dataset);
    expect(task).toEqual({ task: TASK_IRI, state: "Open", title: "Review", assignee: BOB });
    const written = await serializeTurtle(writeTask(new Store(), task as NonNullable<typeof task>));
    expect(written).not.toContain("https://w3id.org/jeswr/");
    expect(parseTask(TASK_IRI, await parseRdf(written, "text/turtle", {}))).toMatchObject(
      task as NonNullable<typeof task>,
    );
  });
});
