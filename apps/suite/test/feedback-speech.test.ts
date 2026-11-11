// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { startVoice } from "../src/feedback/speech";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(speech: boolean) {
  const trackStop = vi.fn();
  const recStop = vi.fn();
  const abort = vi.fn();
  const permission = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  let recorder: Recorder;
  let recognition: Recognizer;
  class Recorder {
    static isTypeSupported = (mime: string) => mime.includes("webm");
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable?: (e: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: () => void;
    constructor() {
      recorder = this;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      recStop();
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["voice"]) });
      this.onstop?.();
    }
  }
  class Recognizer {
    onresult?: (e: unknown) => void;
    onerror?: (e: { error: string }) => void;
    constructor() {
      recognition = this;
    }
    start() {}
    stop() {}
    abort = abort;
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("window", speech ? { SpeechRecognition: Recognizer } : {});
  vi.stubGlobal("navigator", { language: "en-GB", mediaDevices: { getUserMedia: permission } });
  return {
    permission,
    trackStop,
    recStop,
    abort,
    recorder: () => recorder,
    recognition: () => recognition,
  };
}
it("records while dictating, emits live text and attaches the recording", async () => {
  const s = setup(true);
  const text = vi.fn(),
    clip = vi.fn(),
    error = vi.fn(),
    end = vi.fn();
  const session = await startVoice(text, clip, error, end);
  expect(s.recorder().state).toBe("recording");
  s.recognition().onresult?.({ results: [{ isFinal: false, 0: { transcript: "hello" } }] });
  expect(text).toHaveBeenCalledWith("hello");
  s.recognition().onerror?.({ error: "no-speech" });
  s.recognition().onerror?.({ error: "aborted" });
  expect(error).not.toHaveBeenCalled();
  s.recognition().onerror?.({ error: "network" });
  expect(error).toHaveBeenCalledWith(
    "Live transcription is unavailable. Your audio is still being recorded.",
  );
  error.mockClear();
  session.stop();
  expect(clip.mock.calls[0]?.[0].text).toBe("hello");
  expect(clip.mock.calls[0]?.[0].blob.type).toBe("audio/webm");
  expect(s.trackStop).toHaveBeenCalled();
  expect(s.abort).toHaveBeenCalled();
  expect(end).toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it("records without recognition and stops at two minutes", async () => {
  vi.useFakeTimers();
  const s = setup(false);
  const clip = vi.fn();
  await startVoice(vi.fn(), clip, vi.fn(), vi.fn());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(s.recStop).toHaveBeenCalledTimes(1);
  expect(s.trackStop).toHaveBeenCalled();
  expect(clip.mock.calls[0]?.[0].text).toBe("");
});
it("cleans up on cancellation and failed recorder construction, and propagates denied permission", async () => {
  const s = setup(false);
  const clip = vi.fn();
  const session = await startVoice(vi.fn(), clip, vi.fn(), vi.fn());
  session.cancel();
  expect(clip).not.toHaveBeenCalled();
  expect(s.trackStop).toHaveBeenCalled();
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported() {
      throw new Error("unsupported");
    },
  });
  await expect(startVoice(vi.fn(), vi.fn(), vi.fn(), vi.fn())).rejects.toThrow("unsupported");
  expect(s.trackStop).toHaveBeenCalledTimes(3);
  s.permission.mockRejectedValue(new Error("permission denied"));
  await expect(startVoice(vi.fn(), vi.fn(), vi.fn(), vi.fn())).rejects.toThrow("permission denied");
});
