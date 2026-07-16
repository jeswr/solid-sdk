// AUTHORED-BY GPT-5.6 Sol via codex

import { generateUnchecked } from "@jeswr/synthetic-rdf";
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { seedPods } from "../src/index.js";
import { MemoryPod } from "./helpers.js";

const { literal, namedNode, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

it("consumes a real @jeswr/synthetic-rdf result through InstanceRef", async () => {
  const shape = namedNode("https://shapes.example/ApplicantShape");
  const property = namedNode("https://shapes.example/ApplicantShape-name");
  const name = namedNode("https://schema.org/name");
  const shapes = new Store([
    quad(shape, RDF_TYPE, namedNode(`${SH}NodeShape`)),
    quad(shape, namedNode(`${SH}property`), property),
    quad(property, namedNode(`${SH}path`), name),
    quad(property, namedNode(`${SH}datatype`), namedNode(`${XSD}string`)),
    quad(property, namedNode(`${SH}minCount`), literal("1", namedNode(`${XSD}integer`))),
  ]);
  const data = generateUnchecked({
    shapes,
    seed: "solid-seed-integration",
    targets: [{ shape, count: 1 }],
  });
  const pod = new MemoryPod("https://pod.example");

  await seedPods({
    data,
    layout: {
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/mortgage/applicant",
              source: { instance: { shape: shape.value } },
            },
          ],
        },
      ],
    },
  });

  const body = pod.resources.get("https://pod.example/mortgage/applicant")?.body;
  expect(body).toContain("<#it>");
  expect(body).toContain(`<${name.value}>`);
  expect(body).not.toContain("urn:synthetic:");
});
