// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { type Deck, decodeDeck } from "@jeswr/solid-slides";
import { Button, EmptyState, IconButton, toast } from "@jeswr/suite-ui";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  elapsedTime,
  isPresenterCommand,
  presentationStep,
  visibleSlides,
} from "../state/presentation";
import { SlideCanvas } from "./slide-canvas";
export function Presenter({
  deck,
  channelId,
  onClose,
}: {
  deck: Deck;
  channelId: string;
  onClose: () => void;
}) {
  const slides = visibleSlides(deck.slides);
  const [index, setIndex] = useState(0);
  const [started] = useState(() => Date.now());
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ deck, index, started });
  latest.current = { deck, index, started };
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const background = [...document.body.children].filter(
      (element) => element !== stage.current && element instanceof HTMLElement,
    ) as HTMLElement[];
    const old = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    return () => {
      background.forEach((element, index) => {
        element.inert = old[index] ?? false;
      });
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    stage.current?.focus();
    if (typeof BroadcastChannel === "undefined") return;
    const transport = new BroadcastChannel(`solid-slides:${channelId}`);
    channel.current = transport;
    transport.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === "ready") transport.postMessage(JSON.stringify(latest.current));
      if (isPresenterCommand(data)) {
        const next = presentationStep(
          data.key,
          latest.current.index,
          visibleSlides(latest.current.deck.slides).length,
        );
        if (next === "exit") onClose();
        else if (next !== undefined) setIndex(next);
      }
    };
    return () => {
      transport.postMessage("ended");
      transport.close();
      channel.current = null;
    };
  }, [channelId, onClose]);
  useEffect(() => {
    channel.current?.postMessage(JSON.stringify({ deck, index, started }));
  }, [deck, index, started]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const next = presentationStep(event.key, index, slides.length);
      if (next === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (next === "exit") onClose();
      else setIndex(next);
    };
    addEventListener("keydown", keyboard);
    return () => removeEventListener("keydown", keyboard);
  }, [index, slides.length, onClose]);
  useEffect(() => {
    let entered = Boolean(document.fullscreenElement);
    const change = () => {
      if (entered && !document.fullscreenElement) onClose();
      entered = Boolean(document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [onClose]);
  return createPortal(
    <div
      ref={stage}
      className="sld-present"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
    >
      {slides[index] ? (
        <SlideCanvas slide={slides[index]} deck={deck} />
      ) : (
        <EmptyState title="No visible slides" body="Unhide a slide to present it." />
      )}
      <div className="sld-present-controls">
        <IconButton
          label="Previous slide"
          disabled={index === 0}
          onClick={() => setIndex(Math.max(0, index - 1))}
        >
          <ArrowLeft size={18} />
        </IconButton>
        <span role="status">
          Slide {slides.length ? index + 1 : 0} of {slides.length}
        </span>
        <IconButton
          label="Next slide"
          disabled={index >= slides.length - 1}
          onClick={() => setIndex(Math.min(slides.length - 1, index + 1))}
        >
          <ArrowRight size={18} />
        </IconButton>
        <Button
          variant="outline"
          onClick={() => {
            void stage.current
              ?.requestFullscreen?.()
              .catch(() => toast.error("Full screen is unavailable in this browser."));
          }}
        >
          Full screen
        </Button>
        <IconButton label="End presentation" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
    </div>,
    document.body,
  );
}

export function PresenterWindow({ channelId }: { channelId: string }) {
  const [snapshot, setSnapshot] = useState<{ deck: Deck; index: number; started: number }>();
  const [now, setNow] = useState(Date.now);
  const [ended, setEnded] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const transport = new BroadcastChannel(`solid-slides:${channelId}`);
    channel.current = transport;
    transport.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === "ended") {
        setEnded(true);
        return;
      }
      if (typeof data !== "string") return;
      try {
        const parsed = JSON.parse(data);
        if (!Number.isInteger(parsed.index) || parsed.index < 0 || !Number.isFinite(parsed.started))
          return;
        setSnapshot({
          deck: decodeDeck(JSON.stringify(parsed.deck)),
          index: parsed.index,
          started: parsed.started,
        });
      } catch {
        /* Ignore malformed messages from other same-origin pages. */
      }
    };
    transport.postMessage("ready");
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || !isPresenterCommand({ key: event.key }))
        return;
      event.preventDefault();
      transport.postMessage({ key: event.key });
    };
    addEventListener("keydown", keyboard);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      removeEventListener("keydown", keyboard);
      transport.close();
      channel.current = null;
    };
  }, [channelId]);
  if (ended) return <EmptyState title="Presentation ended" body="You can close this window." />;
  if (!snapshot)
    return (
      <EmptyState
        title="Waiting for your presentation"
        body="Keep the presentation open in the original window. Presenter view needs BroadcastChannel support."
      />
    );
  const slides = visibleSlides(snapshot.deck.slides);
  const current = slides[snapshot.index];
  const next = slides[snapshot.index + 1];
  return (
    <div className="sld-page sld-presenter-window">
      <h1>Presenter view</h1>
      <p role="timer" aria-label="Elapsed time">
        {elapsedTime(snapshot.started, now)}
      </p>
      <div className="sld-presenter-grid">
        <section aria-label="Current slide">
          {current && <SlideCanvas slide={current} deck={snapshot.deck} />}
          <h2>Speaker notes</h2>
          <p className="sld-notes-text">{current?.notes || "No speaker notes for this slide."}</p>
        </section>
        <section aria-label="Next slide">
          <h2>Up next</h2>
          {next ? <SlideCanvas slide={next} deck={snapshot.deck} /> : <p>Final slide</p>}
        </section>
      </div>
      <div className="sld-toolbar">
        <Button onClick={() => channel.current?.postMessage({ key: "ArrowLeft" })}>Previous</Button>
        <span>
          Slide {snapshot.index + 1} of {slides.length}
        </span>
        <Button onClick={() => channel.current?.postMessage({ key: "ArrowRight" })}>Next</Button>
        <Button variant="outline" onClick={() => channel.current?.postMessage({ key: "Escape" })}>
          End presentation
        </Button>
      </div>
    </div>
  );
}
