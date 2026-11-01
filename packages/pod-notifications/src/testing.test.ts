// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { FakeEventSource, FakeTimers, FakeWebSocket } from "./testing.js";

test("fake timers order equal deadlines, await callbacks, cancel and validate advances", async () => {
  const timers = new FakeTimers(100);
  const calls: number[] = [];
  timers.setTimeout(() => {
    calls.push(1);
    timers.setTimeout(() => {
      calls.push(3);
    }, 0);
  }, 10);
  timers.setTimeout(() => {
    calls.push(2);
  }, 10);
  timers.setTimeout(() => {
    calls.push(4);
  }, 15);
  const canceled = timers.setTimeout(() => {
    throw new Error("cancelled");
  }, 1);
  timers.clearTimeout(canceled);
  await timers.advanceBy(9);
  expect(calls).toEqual([]);
  await timers.advanceBy(1);
  expect(calls).toEqual([1, 2, 3]);
  expect(timers.now()).toBe(110);
  await timers.advanceBy(5);
  expect(calls).toEqual([1, 2, 3, 4]);
  expect(timers.pending).toBe(0);
  await expect(timers.advanceBy(-1)).rejects.toThrow(TypeError);
  await expect(timers.advanceBy(Infinity)).rejects.toThrow(TypeError);
  expect(new FakeTimers().now()).toBe(0);
});

test("fake EventSource delivers id-bearing messages and lifecycle events; listeners are removable", () => {
  const source = new FakeEventSource("https://pod.example/stream");
  const handler = vi.fn();
  source.dispatch("message", { data: "no listener" });
  source.removeEventListener("message", handler);
  source.addEventListener("message", handler);
  source.addEventListener("message", handler);
  source.open();
  expect(source.readyState).toBe(1);
  source.message("one", "id-1");
  source.message("two");
  source.error();
  source.close();
  expect(source.url).toBe("https://pod.example/stream");
  expect(source.readyState).toBe(2);
  expect(handler.mock.calls).toEqual([
    [{ data: "one", lastEventId: "id-1" }],
    [{ data: "two", lastEventId: "" }],
  ]);
  source.removeEventListener("message", handler);
  expect(source.listenerCount).toBe(0);
});

test("fake sockets record writes only while open and preserve protocol arguments", () => {
  const socket = new FakeWebSocket("wss://pod.example/", ["solid-0.1"]);
  expect(() => socket.send("bad")).toThrow("not open");
  socket.open();
  socket.send("sub https://pod.example/a");
  expect(socket.sent).toEqual(["sub https://pod.example/a"]);
  expect(socket.protocols).toEqual(["solid-0.1"]);
  socket.close();
  expect(socket.readyState).toBe(3);
  expect(() => socket.send("bad")).toThrow("not open");
  expect(new FakeWebSocket("wss://pod.example/").protocols).toEqual([]);
});
