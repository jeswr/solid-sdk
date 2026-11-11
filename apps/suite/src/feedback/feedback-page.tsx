// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, Textarea } from "@jeswr/suite-ui";
import { Mic, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicBaseUrl } from "@/lib/public-url";
import { feedbackArchive, saveFeedbackArchive } from "./download";
import {
  type Answer,
  type Answers,
  interviewPlan,
  opening,
  type Pathway,
  type Question,
  questionById,
  readWalkthrough,
  stages,
} from "./guide";
import { useVoice, type VoiceClip } from "./speech";
import type { Message, Submission } from "./validation";

type TranscriptMessage = Message & { audio?: number[] };
export function feedbackApiBase(): string {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") return "";
  try {
    return publicBaseUrl(
      process.env.NEXT_PUBLIC_PUBLIC_SUITE_URL ?? "https://solid-suite.vercel.app",
    );
  } catch {
    return "";
  }
}
function Controls({
  question: q,
  onAnswer,
  disabled,
  selected = [],
}: {
  question: Question;
  onAnswer: (text: string, value: Answer) => void;
  disabled: boolean;
  selected?: string[];
}) {
  const [multi, setMulti] = useState<string[]>(selected);
  if (q.type === "scale")
    return (
      <fieldset disabled={disabled}>
        <legend>{q.text}</legend>
        <div className="flex flex-wrap gap-2 py-2">
          {Array.from({ length: q.max ?? 7 }, (_, i) => i + 1).map((n) => (
            <Button
              key={n}
              variant="outline"
              onClick={() => onAnswer(String(n), n)}
              aria-label={`${n} out of ${q.max ?? 7}`}
            >
              {n}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          1: {q.minLabel}. {q.max}: {q.maxLabel}.
        </p>
      </fieldset>
    );
  if (q.type === "choice")
    return (
      <fieldset disabled={disabled}>
        <legend>{q.text}</legend>
        <div className="flex flex-wrap gap-2 py-2">
          {q.options?.map((o) => (
            <Button key={o.value} variant="outline" onClick={() => onAnswer(o.label, o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      </fieldset>
    );
  if (q.type === "multi")
    return (
      <fieldset disabled={disabled}>
        <legend>{q.text}</legend>
        <div className="flex flex-wrap gap-2 py-2">
          {q.options?.map((o) => (
            <Button
              key={o.value}
              variant={multi.includes(o.value) ? "default" : "outline"}
              aria-pressed={multi.includes(o.value)}
              disabled={!multi.includes(o.value) && !!q.max && multi.length >= q.max}
              onClick={() =>
                setMulti((m) =>
                  m.includes(o.value) ? m.filter((v) => v !== o.value) : [...m, o.value],
                )
              }
            >
              {o.label}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            onAnswer(
              multi.length
                ? multi.map((v) => q.options?.find((o) => o.value === v)?.label ?? v).join(", ")
                : "I didn't try any apps",
              multi,
            )
          }
        >
          Continue with these apps
        </Button>
      </fieldset>
    );
  return null;
}
function localSummary(answers: Answers): string {
  const picks = [
    answers.general,
    answers.context_work,
    answers.incident_best,
    answers.incident_stuck,
    answers.values_control,
    answers.jobs_use,
    answers.one_change,
    answers.comments,
  ].filter((v) => typeof v === "string" && v !== "(skipped)") as string[];
  return (
    picks
      .slice(0, 5)
      .map((v) => `• ${v.slice(0, 600)}`)
      .join("\n") ||
    "• You shared the answers recorded above. You can add anything else before submitting."
  );
}
export function FeedbackPage() {
  const [hosted, setHosted] = useState<boolean | null>(null);
  const [pathway, setPathway] = useState<Pathway>();
  const [answers, setAnswers] = useState<Answers>({});
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [question, setQuestion] = useState<Question>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState<number>();
  const [clips, setClips] = useState<VoiceClip[]>([]);
  const [pending, setPending] = useState<number[]>([]);
  const [walkthrough, setWalkthrough] = useState<string[]>([]);
  const voiceBase = useRef("");
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const voice = useVoice(
    (text) => setInput([voiceBase.current, text].filter(Boolean).join(" ").slice(0, 4000)),
    (clip) => {
      setClips((current) => [...current, clip]);
      setPending((current) => [...current, clips.length]);
    },
  );
  useEffect(() => {
    try {
      setWalkthrough(readWalkthrough(localStorage.getItem("suite.walkthrough.v1")));
    } catch {
      /* Private browsing may block storage. */
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    fetch(`${feedbackApiBase()}/api/feedback/turn`, {
      signal: controller.signal,
      credentials: "omit",
    })
      .then((r) => (r.ok ? r.json() : { hosted: false }))
      .then((r) => setHosted(r.hosted === true))
      .catch(() => setHosted(false))
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (messages.length) transcriptEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length]);
  function start(p: Pathway) {
    const q = questionById(p === "quick" ? "general" : "context_work");
    setPathway(p);
    setQuestion(q);
    setAnswers(walkthrough.length ? { apps: walkthrough } : {});
    setMessages([
      {
        role: "assistant",
        content: `${p === "guided" ? opening : "Tell us anything, in your own words. You can type or record it, and nothing is submitted to the team until you press Submit."}\n\n${q?.text}`,
      },
    ]);
  }
  function advanceLocal(nextAnswers: Answers, transcript: TranscriptMessage[], current: Question) {
    if (current.id === "confirmed" && nextAnswers.confirmed === "yes") {
      setDone(true);
      setQuestion(undefined);
      setMessages([
        ...transcript,
        { role: "assistant", content: "Thank you. Your feedback is ready to submit." },
      ]);
      return;
    }
    if (current.id === "confirmed") {
      const summary =
        `${nextAnswers.summary ?? localSummary(nextAnswers)}\n• Correction: ${transcript.at(-1)?.content ?? ""}`.slice(
          0,
          4000,
        );
      setAnswers({ ...nextAnswers, summary });
      setMessages([
        ...transcript,
        { role: "assistant", content: `${summary}\n\nDid I get that right?` },
      ]);
      return;
    }
    const plan = interviewPlan(nextAnswers);
    const index = plan.findIndex((q) => q.id === current.id);
    const next = pathway === "quick" ? questionById("confirmed") : plan[index + 1];
    if (!next || next.id === "confirmed") {
      const summary = localSummary(nextAnswers);
      setAnswers({ ...nextAnswers, summary });
      setQuestion(questionById("confirmed"));
      setMessages([
        ...transcript,
        {
          role: "assistant",
          content: `${summary}\n\nDid I get that right? You can type corrections.`,
        },
      ]);
    } else {
      setQuestion(next);
      setMessages([...transcript, { role: "assistant", content: next.text }]);
    }
  }
  async function send(text = input.trim(), value?: Answer) {
    if (
      !pathway ||
      !question ||
      sending.current ||
      voice.listening ||
      voice.starting ||
      (!text && !pending.length)
    )
      return;
    if (question.id === "confirmed" && value === "(skipped)") {
      setError("You can submit what you've said so far without confirming the read-back.");
      return;
    }
    const content = text || "(voice answer recorded; no transcript)";
    const nextAnswers = { ...answers };
    if (question.id === "confirmed") {
      if (value === "yes") nextAnswers.confirmed = "yes";
      else delete nextAnswers.confirmed;
    } else if (value !== undefined) nextAnswers[question.id] = value;
    else if (question.type === "text") nextAnswers[question.id] = content;
    else if (
      question.type === "scale" &&
      /^\d+$/.test(content) &&
      Number(content) >= 1 &&
      Number(content) <= (question.max ?? 7)
    )
      nextAnswers[question.id] = Number(content);
    const transcript: TranscriptMessage[] = [
      ...messages,
      { role: "user", content, ...(pending.length ? { audio: pending } : {}) },
    ];
    setInput("");
    setPending([]);
    setAnswers(nextAnswers);
    setMessages(transcript);
    setError("");
    if (!hosted || transcript.filter((m) => m.role === "user").length >= 40) {
      if (hosted) setHosted(false);
      advanceLocal(nextAnswers, transcript, question);
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const r = await fetch(`${feedbackApiBase()}/api/feedback/turn`, {
        method: "POST",
        signal: AbortSignal.timeout(75_000),
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pathway,
          messages: transcript.slice(-40).map((m) => ({ role: m.role, content: m.content })),
          answers: nextAnswers,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "The interviewer couldn't reply.");
      setAnswers(result.answers);
      setQuestion(result.question);
      setDone(result.done === true);
      setMessages([...transcript, { role: "assistant", content: result.reply }]);
    } catch {
      setHosted(false);
      setError(
        "The interviewer couldn't reply. Your answer has been kept. You can continue with the plain form or submit it now.",
      );
      advanceLocal(nextAnswers, transcript, question);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function record(): Submission {
    const remaining: TranscriptMessage[] =
      input.trim() || pending.length
        ? [
            {
              role: "user",
              content: input.trim() || "(voice answer recorded; no transcript)",
              ...(pending.length ? { audio: pending } : {}),
            },
          ]
        : [];
    const draftAnswers = { ...answers };
    if (input.trim() && question?.type === "text") draftAnswers[question.id] = input.trim();
    return {
      pathway: pathway ?? "quick",
      answers: draftAnswers,
      transcript: [...messages, ...remaining],
      contact: { name, email },
      metadata: {
        version: process.env.NEXT_PUBLIC_SUITE_VERSION ?? "preview",
        commit: process.env.NEXT_PUBLIC_SUITE_COMMIT ?? "",
        userAgent: navigator.userAgent.slice(0, 1000),
        walkthrough,
      },
    };
  }
  async function submit() {
    if (sending.current || voice.listening || voice.starting) return;
    setError("");
    sending.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("json", JSON.stringify(record()));
      clips.forEach((clip, i) => {
        form.append("audio", clip.blob, `audio-${i + 1}`);
      });
      const r = await fetch(`${feedbackApiBase()}/api/feedback/submit`, {
        method: "POST",
        signal: AbortSignal.timeout(75_000),
        credentials: "omit",
        body: form,
      });
      const result = await r.json();
      if (!r.ok || !Number.isSafeInteger(result.reference))
        throw new Error(
          result.error || "We couldn't submit your feedback. Download a copy to keep it.",
        );
      setReference(result.reference);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn't submit your feedback. Download a copy to keep it.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function download() {
    setError("");
    setBusy(true);
    try {
      const bytes = await feedbackArchive(record(), clips);
      if (!(await saveFeedbackArchive(bytes)))
        setError("The save was cancelled. Your feedback is still here.");
    } catch {
      setError("The download couldn't be created. Please try again before leaving this page.");
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || voice.listening || voice.starting;
  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Link href="/welcome" className="text-sm underline">
        Back to welcome
      </Link>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold">Give feedback</h1>
        <p>Tell us honestly what worked and what got in the way. Type or talk.</p>
      </header>
      <aside className="rounded-xl border bg-muted p-4 text-sm space-y-2">
        <p>
          When you submit, we store your answers, the chat transcript and any voice recordings in a
          private GitHub repository for the suite team only. Optional name and email are stored with
          them. Please don't include anything confidential.
        </p>
        <p>
          Each answer sent to the interviewer is processed by Anthropic. Your recordings stay in
          this page until you submit or download them. Your browser's speech service may process
          audio for live dictation. Check the transcript before sending. Keep this page open until
          you have submitted or downloaded your feedback.
        </p>
      </aside>
      {hosted === false && (
        <p role="status" className="rounded-xl border p-4">
          The interviewer isn't switched on yet; you can still type or record feedback and submit
          it. The guide is available as a plain form.
        </p>
      )}
      {reference ? (
        <div role="status" className="rounded-xl border p-6 text-lg">
          Thanks, your reference is #{reference}.
        </div>
      ) : !pathway ? (
        <div className="flex flex-wrap gap-3">
          <Button disabled={hosted === null} onClick={() => start("guided")}>
            Guided interview
          </Button>
          <Button disabled={hosted === null} variant="outline" onClick={() => start("quick")}>
            Just tell us
          </Button>
          <p className="w-full text-sm text-muted-foreground">
            The guided interview takes about ten minutes. A quick note takes as long as you need.
          </p>
        </div>
      ) : (
        <>
          <div>
            <Label htmlFor="feedback-progress">
              {pathway === "quick" ? "Quick note" : stages[question?.stage ?? 7]}
            </Label>
            <progress
              id="feedback-progress"
              className="w-full"
              value={done ? 8 : (question?.stage ?? 0)}
              max={8}
              aria-label="Interview progress"
            />
          </div>
          <div
            role="log"
            aria-label="Feedback conversation"
            aria-live="polite"
            className="max-h-[28rem] space-y-4 overflow-y-auto rounded-xl border p-4"
          >
            {messages.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: The transcript is append-only.
                key={`${i}-${m.role}`}
                className={m.role === "user" ? "ml-6 rounded-lg bg-muted p-3" : "mr-6 p-2"}
              >
                <p className="text-xs font-semibold">{m.role === "user" ? "You" : "Interviewer"}</p>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.audio?.map((index) => (
                  <div key={index} className="text-sm">
                    Audio recording {index + 1} attached
                  </div>
                ))}
              </div>
            ))}
            <div ref={transcriptEnd} />
          </div>
          {!done && question && (
            <div className="space-y-3">
              <Controls
                key={question.id}
                question={question}
                disabled={locked}
                selected={question.id === "apps" ? walkthrough : []}
                onAnswer={(text, value) => void send(text, value)}
              />
              <Label htmlFor="feedback-answer">Your answer</Label>
              <Textarea
                id="feedback-answer"
                maxLength={4000}
                rows={4}
                value={input}
                disabled={locked}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type here, or use the microphone"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={locked || (!input.trim() && !pending.length)}
                  onClick={() => void send()}
                >
                  Send answer
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    voice.starting ||
                    (!voice.listening && (!voice.supported || clips.length >= 10))
                  }
                  aria-label={voice.listening ? "Stop recording" : "Speak your answer"}
                  aria-pressed={voice.listening}
                  onClick={() => {
                    if (voice.listening) voice.stop();
                    else {
                      voiceBase.current = input;
                      void voice.start();
                    }
                  }}
                >
                  {voice.listening ? <Square aria-hidden="true" /> : <Mic aria-hidden="true" />}
                  {voice.listening ? "Stop recording" : "Speak"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => void send("Skip", "(skipped)")}
                >
                  Skip
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {voice.listening
                  ? "Recording. Stops after two minutes."
                  : `${clips.length} of 10 recordings attached. Up to two minutes each.`}{" "}
                {pending.length > 0 && "Your recording will be attached to your next answer."}{" "}
                {!voice.supported &&
                  "Voice recording is unavailable in this browser. You can type instead."}
              </p>
              {voice.error && <p role="status">{voice.error}</p>}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="feedback-name">Name (optional)</Label>
              <Input
                id="feedback-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="feedback-email">Email (optional)</Label>
              <Input
                id="feedback-email"
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">Leave both blank to stay anonymous.</p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border p-3">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={locked || (messages.length < 2 && !input.trim() && !pending.length)}
              onClick={() => void submit()}
            >
              {busy ? "Please wait" : done ? "Submit" : "Submit what I've said so far"}
            </Button>
            <Button
              variant="outline"
              disabled={locked || (messages.length < 2 && !input.trim() && !pending.length)}
              onClick={() => void download()}
            >
              Download my feedback
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
