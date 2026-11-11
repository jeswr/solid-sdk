// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useRef, useState } from "react";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
}
type RecognitionConstructor = new () => Recognition;
export interface VoiceClip {
  blob: Blob;
  text: string;
}
export interface VoiceSession {
  stop(): void;
  cancel(): void;
}
/** Recording is mandatory even when browser dictation is available. */
export async function startVoice(
  onText: (text: string) => void,
  onClip: (clip: VoiceClip) => void,
  onError: (error: string) => void,
  onEnd: () => void,
): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder: MediaRecorder;
  let recognition: Recognition | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let latest = "";
  let session: VoiceSession;
  try {
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32000,
    });
    const chunks: Blob[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      recognition?.abort();
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      onEnd();
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size) {
        chunks.push(e.data);
        size += e.data.size;
      }
      if (size >= 2_800_000 && recorder.state !== "inactive") session.stop();
    };
    recorder.onerror = () => {
      cancelled = true;
      cleanup();
      onError("The recording stopped unexpectedly. Please try again or type your answer.");
    };
    recorder.onstop = () => {
      cleanup();
      if (cancelled) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (blob.size && blob.size <= 3 * 1024 * 1024) onClip({ blob, text: latest });
      else onError("That recording could not be attached. Please try a shorter answer.");
    };
    const w = window as unknown as {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Constructor) {
      recognition = new Constructor();
      recognition.lang = navigator.language || "en-GB";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (e) => {
        latest = Array.from(e.results)
          .map((r) => r[0].transcript)
          .join(" ")
          .trim();
        onText(latest);
      };
      recognition.onerror = (event) => {
        if (
          !cancelled &&
          recorder.state === "recording" &&
          !["aborted", "no-speech"].includes(event.error)
        )
          onError("Live transcription is unavailable. Your audio is still being recorded.");
      };
    }
    session = {
      stop() {
        recognition?.stop();
        if (recorder.state !== "inactive") recorder.stop();
      },
      cancel() {
        cancelled = true;
        if (recorder.state !== "inactive") recorder.stop();
        cleanup();
      },
    };
    recorder.start(1000);
    timer = setTimeout(() => session.stop(), 120_000);
    try {
      recognition?.start();
    } catch {
      onError("Live transcription is unavailable. Your audio is still being recorded.");
    }
    return session;
  } catch (error) {
    clearTimeout(timer);
    recognition?.abort();
    stream.getTracks().forEach((t) => {
      t.stop();
    });
    throw error;
  }
}
export function useVoice(onText: (text: string) => void, onClip: (clip: VoiceClip) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const session = useRef<VoiceSession | undefined>(undefined);
  const mounted = useRef(false);
  const startingRef = useRef(false);
  const callbacks = useRef({ onText, onClip });
  callbacks.current = { onText, onClip };
  useEffect(() => {
    mounted.current = true;
    setSupported(
      typeof MediaRecorder !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function",
    );
    return () => {
      mounted.current = false;
      session.current?.cancel();
    };
  }, []);
  async function start() {
    if (startingRef.current || session.current) return;
    startingRef.current = true;
    setStarting(true);
    setError("");
    try {
      const active = await startVoice(
        (text) => {
          if (mounted.current) callbacks.current.onText(text);
        },
        (clip) => {
          if (mounted.current) callbacks.current.onClip(clip);
        },
        (text) => {
          if (mounted.current) setError(text);
        },
        () => {
          session.current = undefined;
          if (mounted.current) setListening(false);
        },
      );
      if (!mounted.current) active.cancel();
      else {
        session.current = active;
        setListening(true);
      }
    } catch {
      if (mounted.current)
        setError(
          "We couldn't use the microphone. Check its permission in your browser, or type your answer.",
        );
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  }
  return { supported, listening, starting, error, start, stop: () => session.current?.stop() };
}
