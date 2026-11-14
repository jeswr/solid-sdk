// AUTHORED-BY Codex GPT-6.1-Sol
import type { BrowserContext, Request, Response } from "playwright";
import { expect, it } from "vitest";
import { BODY_LIMIT, Recorder } from "../src/recorder.js";

it.each([
  ['<div role="alert">Deleted successfully</div>', false],
  ['<div role="alert" class="alert-success">Deleted successfully</div>', false],
  ['<div role="alert" class="alert-danger">Your product could not be deleted.</div>', true],
  ['<div role="alert" class="alert-warning">Try again</div>', true],
  ['<div role="alert" aria-invalid="true">Invalid</div>', true],
])("r12 records complete-response failure independently of neutral flashes (%s)", async (flash, failed) => {
  const handlers = new Map<string, (event: unknown) => void>();
  const context = {
    route: async () => undefined,
    on: (event: string, listener: (value: unknown) => void) => {
      handlers.set(event, listener);
    },
  } as unknown as BrowserContext;
  const recorder = new Recorder("https://shop.test");
  recorder.phase = "demonstration";
  recorder.demonstration = "delete-example";
  await recorder.attach(context);
  const request = {
    url: () => "https://shop.test/products",
    method: () => "GET",
    resourceType: () => "document",
    allHeaders: async () => ({}),
    redirectedFrom: () => null,
    postData: () => null,
  } as unknown as Request;
  handlers.get("request")?.(request);
  await recorder.flush();
  const response = {
    request: () => request,
    status: () => 200,
    allHeaders: async () => ({ "content-type": "text/html" }),
    headersArray: async () => [],
    text: async () => `<main>Products</main>${" ".repeat(BODY_LIMIT)}${flash}`,
  } as unknown as Response;
  handlers.get("response")?.(response);
  await recorder.flush();
  expect(recorder.trace).toHaveLength(1);
  expect(recorder.trace[0]).toMatchObject({
    responsePageError: failed,
    responsePageFailure: failed,
    bodyTruncated: true,
  });
  expect(recorder.trace[0]?.responseFlash).toHaveLength(1);
  expect(recorder.trace[0]?.bodySample).not.toContain(flash);
});
