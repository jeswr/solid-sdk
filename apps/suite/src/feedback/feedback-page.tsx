// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, Textarea } from "@jeswr/suite-ui";
import { Mic, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicBaseUrl } from "@/lib/public-url";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import { onBeforeSignOut } from "@/shell/session/sign-out-cleanup";
import { asFailure, FeedbackFailure, failureMessage, feedbackResponse } from "./client-errors";
import { feedbackArchive, saveFeedbackArchive } from "./download";
import {
  audioIndices,
  loadDraft,
  lostRecordings,
  MAX_RECORDINGS,
  ownerOf,
  purgeDrafts,
  receiptUsable,
  clearDraft as removeDraft,
  type StoredDraft,
  saveDraft as storeDraft,
  withoutRecordings,
} from "./draft";
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
import type { AudioReceipt } from "./receipts";
import { useVoice, type VoiceClip, voiceInThisBuild } from "./speech";
import { type Message, type Submission, validateAnswers, validateSubmission } from "./validation";

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
const browserStorage = (): Storage | undefined => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};
const recordingsLostMessage = (maybeSaved: boolean) =>
  `Your recordings can no longer be sent: audio only stays while this page is open, and the saved copies have expired or were never kept. You can submit your answers without the recordings, or remove them and record again.${maybeSaved ? " If an earlier attempt already reached the team, they may receive this feedback twice." : ""}`;
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
/** Drafts belong to the active account; switching account remounts the form and restores nothing. */
export function FeedbackPage() {
  const accounts = useOptionalAccounts();
  if (accounts?.status === "loading")
    return (
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-10">
        <p role="status">Loading your account...</p>
      </main>
    );
  const owner = ownerOf(accounts?.active?.id);
  return <FeedbackForm key={owner} owner={owner} />;
}
function FeedbackForm({ owner }: { owner: string }) {
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
  const clipsRef = useRef<VoiceClip[]>([]);
  const receipts = useRef<(AudioReceipt | undefined)[]>([]);
  const submissionId = useRef("");
  const [frozenRecord, setFrozenRecord] = useState<string>();
  const [savingRecordings, setSavingRecordings] = useState(0);
  const uploading = useRef(0);
  const [pending, setPending] = useState<number[]>([]);
  const [walkthrough, setWalkthrough] = useState<string[]>([]);
  const voiceBase = useRef("");
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  // Set once an attempt may have reached storage (a failed save or a restored draft).
  // After that, a rejection must not unfreeze a record GitHub may already hold.
  const uncertain = useRef(false);
  const [pendingDraft, setPendingDraft] = useState<StoredDraft>();
  // Why the recordings can no longer be sent; empty while they can.
  const [goneReason, setGoneReason] = useState("");
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [notice, setNotice] = useState("");
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const newHeading = useRef<HTMLHeadingElement>(null);
  const startNewButton = useRef<HTMLButtonElement>(null);
  const voice = useVoice(
    (text) => setInput([voiceBase.current, text].filter(Boolean).join(" ").slice(0, 4000)),
    (clip) => {
      if (clipsRef.current.length >= MAX_RECORDINGS || clip.blob.size > 3 * 1024 * 1024) {
        setError("You can attach up to ten recordings of 3 MB each. Please use a shorter answer.");
        return;
      }
      const index = clipsRef.current.length;
      clipsRef.current = [...clipsRef.current, clip];
      setClips(clipsRef.current);
      setPending((current) => [...current, index]);
      void uploadRecording(clip, index).catch((error) =>
        setError(failureMessage(asFailure(error).kind, { recordingsHere: true, stage: "upload" })),
      );
    },
  );
  useEffect(() => {
    // Drafts are offered, never restored silently, and only ever to the account that saved them.
    purgeDrafts(browserStorage());
    setPendingDraft(loadDraft(browserStorage(), owner));
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
      .then(feedbackResponse)
      .then((r) => setHosted(r.hosted === true))
      .catch(() => setHosted(false))
      .finally(() => clearTimeout(timer));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [owner]);
  // The account's draft holds a transcript, name and email: it must not outlive its session.
  useEffect(
    () =>
      onBeforeSignOut(async (account) => {
        removeDraft(browserStorage(), ownerOf(account.id));
      }),
    [],
  );
  useEffect(() => {
    if (pendingDraft) draftHeading.current?.focus();
  }, [pendingDraft]);
  useEffect(() => {
    if (confirmingNew) newHeading.current?.focus();
  }, [confirmingNew]);
  function restoreDraft(draft: StoredDraft) {
    setPendingDraft(undefined);
    try {
      const saved = validateSubmission(JSON.parse(draft.record));
      submissionId.current = draft.submissionId;
      receipts.current = draft.receipts.map((receipt) => receipt ?? undefined);
      uncertain.current = true;
      setFrozenRecord(draft.record);
      setPathway(saved.pathway);
      setAnswers(saved.answers);
      setMessages(saved.transcript.map(({ audio, ...m }) => (audio ? { ...m, audio } : m)));
      setName(saved.contact.name);
      setEmail(saved.contact.email);
      setDone(true);
      // Audio never survives a reload, so only receipts that are still valid can be sent.
      if (lostRecordings(saved, draft.receipts, () => false).length)
        setGoneReason(recordingsLostMessage(true));
    } catch {
      /* An invalid local draft must not prevent a new interview. */
      removeDraft(browserStorage(), owner);
      setNotice("That saved draft couldn't be restored and was discarded.");
    }
  }
  function discardDraft() {
    removeDraft(browserStorage(), owner);
    setPendingDraft(undefined);
  }
  useEffect(() => {
    if (messages.length) transcriptEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length]);
  async function uploadRecording(clip: VoiceClip, index: number): Promise<AudioReceipt> {
    uploading.current++;
    setSavingRecordings(uploading.current);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(
            `${feedbackApiBase()}/api/feedback/audio?submissionId=${submissionId.current}`,
            {
              method: "POST",
              credentials: "omit",
              signal: AbortSignal.timeout(45_000),
              headers: { "Content-Type": clip.blob.type },
              body: clip.blob,
            },
          );
          const receipt = await feedbackResponse(response);
          if (
            receipt.submissionId !== submissionId.current ||
            typeof receipt.sha !== "string" ||
            !/^[a-f0-9]{40,64}$/.test(receipt.sha) ||
            receipt.size !== clip.blob.size ||
            !["webm", "ogg", "m4a"].includes(receipt.ext) ||
            typeof receipt.sig !== "string" ||
            !/^\d{13}\.[a-f0-9]{64}$/.test(receipt.sig)
          )
            throw new Error("Recording receipt is unavailable.");
          receipts.current[index] = receipt;
          return receipt;
        } catch (error) {
          // A definite answer (rejected, too large, limited) will not change on a second try.
          if (error instanceof FeedbackFailure && !error.mayHaveStored) throw error;
          if (error instanceof FeedbackFailure && error.kind === "retry-later") throw error;
          if (attempt === 1) throw new Error("Recording could not be saved.");
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      throw new Error("Recording could not be saved.");
    } finally {
      uploading.current--;
      setSavingRecordings(uploading.current);
    }
  }
  function start(p: Pathway) {
    submissionId.current = crypto.randomUUID();
    uncertain.current = false;
    setFrozenRecord(undefined);
    clearDraft();
    setGoneReason("");
    setConfirmingNew(false);
    setNotice("");
    setInput("");
    setName("");
    setEmail("");
    setDone(false);
    setError("");
    setClips([]);
    clipsRef.current = [];
    receipts.current = [];
    setPending([]);
    const q = questionById(p === "quick" ? "general" : "context_work");
    setPathway(p);
    setQuestion(q);
    setAnswers(walkthrough.length ? { apps: walkthrough } : {});
    setMessages([
      {
        role: "assistant",
        content: `${p === "guided" ? opening : "Tell us anything, in your own words. You can type or record it. Recordings are saved privately when you stop recording. Press Submit to send your interview record to the team."}\n\n${q?.text}`,
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
      frozenRecord !== undefined ||
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
          messages: (transcript.length > 40
            ? [...transcript.slice(0, 1), ...transcript.slice(-39)]
            : transcript
          ).map((m) => ({ role: m.role, content: m.content })),
          answers: nextAnswers,
        }),
      });
      const result = await feedbackResponse(r);
      if (typeof result.reply !== "string" || typeof result.done !== "boolean")
        throw new Error("The interviewer couldn't reply.");
      const nextQuestion = result.question ? questionById(result.question.id) : undefined;
      if (!result.done && !nextQuestion) throw new Error("The next question is unavailable.");
      setAnswers(validateAnswers(result.answers));
      setQuestion(nextQuestion);
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
  const clipHere = (index: number) => index < clipsRef.current.length;
  async function submit(override?: string) {
    if (sending.current || voice.listening || voice.starting || uploading.current) return;
    setError("");
    setNotice("");
    sending.current = true;
    setBusy(true);
    let stage: "upload" | "submit" = "upload";
    let serialized = "";
    try {
      // The ID reserves this exact record, even if GitHub commits it but issue creation fails.
      serialized = override ?? frozenRecord ?? JSON.stringify(record());
      const parsed = JSON.parse(serialized) as Submission;
      setFrozenRecord(serialized);
      saveDraft(serialized);
      // Recordings that cannot be renewed (the audio is gone) fail before any request.
      if (lostRecordings(parsed, receipts.current, clipHere).length) {
        setGoneReason(recordingsLostMessage(uncertain.current));
        return;
      }
      const count = Math.max(clipsRef.current.length, Math.max(-1, ...audioIndices(parsed)) + 1);
      for (let i = 0; i < count; i++) {
        const clip = clipsRef.current[i];
        if (clip && !receiptUsable(receipts.current[i], Date.now()))
          receipts.current[i] = await uploadRecording(clip, i);
      }
      // Receipts go by position: a gap would shift every later recording on the server. The
      // check above guarantees each slot has a usable receipt or a clip just uploaded.
      const saved = Array.from({ length: count }, (_, i) => receipts.current[i]).filter(
        (receipt): receipt is AudioReceipt => !!receipt,
      );
      saveDraft(serialized);
      stage = "submit";
      const r = await fetch(`${feedbackApiBase()}/api/feedback/submit`, {
        method: "POST",
        signal: AbortSignal.timeout(75_000),
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: `{"submissionId":${JSON.stringify(submissionId.current)},"record":${serialized},"receipts":${JSON.stringify(saved)}}`,
      });
      const result = await feedbackResponse(r);
      if (!Number.isSafeInteger(result.reference) || result.reference < 1)
        throw new Error("Feedback reference is unavailable.");
      setReference(result.reference);
      clearDraft();
    } catch (error) {
      const failure = asFailure(error);
      // Only an answer that may have reached storage makes the record uncertain; a limiter
      // refusal or a rejected upload never did.
      if (stage === "submit" && failure.mayHaveStored) uncertain.current = true;
      let parsed: Submission | undefined;
      try {
        parsed = JSON.parse(serialized) as Submission;
      } catch {
        parsed = undefined;
      }
      const here = !parsed || audioIndices(parsed).every(clipHere);
      if (failure.kind === "receipts") receipts.current = []; // Stale: never resend them.
      if (failure.kind === "receipts" && parsed && lostRecordings(parsed, [], clipHere).length)
        setGoneReason(recordingsLostMessage(uncertain.current));
      else if (stage === "upload" && ["invalid", "too-large", "unsupported"].includes(failure.kind))
        setGoneReason(failureMessage(failure.kind, { recordingsHere: here, stage }));
      else setError(failureMessage(failure.kind, { recordingsHere: here, stage }));
      // The server validates before it writes anything, so a rejected first attempt can be edited.
      if (
        stage === "submit" &&
        !uncertain.current &&
        ["invalid", "too-large", "unsupported", "receipts"].includes(failure.kind)
      ) {
        setFrozenRecord(undefined);
        clearDraft();
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  /** A new submission ID with every recording reference removed; nothing is sent yet. */
  function removeRecordings(): string {
    const current: Submission = frozenRecord ? JSON.parse(frozenRecord) : record();
    const stripped = withoutRecordings(current);
    submissionId.current = crypto.randomUUID();
    clipsRef.current = [];
    setClips([]);
    receipts.current = [];
    setPending([]);
    uncertain.current = false;
    setGoneReason("");
    setError("");
    clearDraft();
    setMessages(stripped.transcript as TranscriptMessage[]);
    return JSON.stringify(stripped);
  }
  async function submitWithoutRecordings() {
    await submit(removeRecordings());
  }
  function recordAgain() {
    removeRecordings();
    setFrozenRecord(undefined);
    setDone(false);
    setQuestion(questionById("confirmed"));
    setNotice(
      "Recordings removed. Type or record what you'd like to add, press Send answer, then Submit.",
    );
  }
  function saveDraft(serialized: string) {
    storeDraft(browserStorage(), owner, {
      submissionId: submissionId.current,
      record: serialized,
      receipts: Array.from(
        { length: receipts.current.length },
        (_, i) => receipts.current[i] ?? null,
      ),
    });
  }
  function clearDraft() {
    removeDraft(browserStorage(), owner);
  }
  async function download() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const current: Submission = frozenRecord ? JSON.parse(frozenRecord) : record();
      const bytes = await feedbackArchive(current, clips);
      if (!(await saveFeedbackArchive(bytes))) {
        setError("The save was cancelled. Your feedback is still here.");
      } else {
        // Audio never survives a reload, so say so rather than imply the archive holds it.
        const missing = audioIndices(current).filter((i) => !clips[i]);
        if (missing.length)
          setNotice(
            `Downloaded your answers without ${missing.length === 1 ? "recording" : "recordings"} ${missing.map((i) => i + 1).join(", ")}: the audio is no longer in this browser.`,
          );
      }
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
          Each answer sent to the interviewer is processed by Anthropic. Recordings are saved
          privately as soon as you stop recording; Submit sends your answers and creates the team
          feedback record. Copies also stay in this page for download. Your browser's speech service
          may process audio for live dictation. Check the transcript before sending. Keep this page
          open until you have submitted or downloaded your feedback.
        </p>
      </aside>
      {hosted === false && (
        <p role="status" className="rounded-xl border p-4">
          The interviewer isn't switched on yet; you can still type or record feedback and submit
          it. The guide is available as a plain form.
        </p>
      )}
      {pendingDraft && !pathway && (
        <section
          role="alert"
          aria-labelledby="feedback-draft-heading"
          className="space-y-3 rounded-xl border p-4"
        >
          <h2
            id="feedback-draft-heading"
            tabIndex={-1}
            ref={draftHeading}
            className="text-lg font-semibold"
          >
            Restore your unsent feedback?
          </h2>
          <p>
            You have feedback from {new Date(pendingDraft.savedAt).toLocaleString()} that wasn't
            sent. It includes your answers and any name or email you entered, and is kept in this
            browser for this account only. Recordings are not kept across a reload.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => restoreDraft(pendingDraft)}>Restore it</Button>
            <Button variant="outline" onClick={discardDraft}>
              Discard it
            </Button>
          </div>
        </section>
      )}
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {reference ? (
        <div role="status" className="rounded-xl border p-6 text-lg">
          Thanks, your reference is #{reference}.
        </div>
      ) : !pathway ? (
        <div className="flex flex-wrap gap-3">
          <Button disabled={hosted === null || !!pendingDraft} onClick={() => start("guided")}>
            Guided interview
          </Button>
          <Button
            disabled={hosted === null || !!pendingDraft}
            variant="outline"
            onClick={() => start("quick")}
          >
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
                disabled={locked || frozenRecord !== undefined}
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
                readOnly={frozenRecord !== undefined}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type here, or use the microphone"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={
                    locked || frozenRecord !== undefined || (!input.trim() && !pending.length)
                  }
                  onClick={() => void send()}
                >
                  Send answer
                </Button>
                {voiceInThisBuild && (
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      frozenRecord !== undefined ||
                      savingRecordings > 0 ||
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
                )}
                <Button
                  variant="ghost"
                  disabled={locked || frozenRecord !== undefined}
                  onClick={() => void send("Skip", "(skipped)")}
                >
                  Skip
                </Button>
              </div>
              {!voiceInThisBuild ? (
                <p className="text-sm text-muted-foreground">
                  Voice answers are available in the web version of the suite.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {voice.listening
                    ? "Recording. Stops after two minutes."
                    : `${clips.length} of 10 recordings attached. Up to two minutes each.`}{" "}
                  {pending.length > 0 && "Your recording will be attached to your next answer."}{" "}
                  {!voice.supported &&
                    "Voice recording is unavailable in this browser. You can type instead."}
                </p>
              )}
              {voice.error && <p role="status">{voice.error}</p>}
            </div>
          )}
          {savingRecordings > 0 && (
            <p role="status" className="text-sm">
              Saving recording...
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="feedback-name">Name (optional)</Label>
              <Input
                id="feedback-name"
                value={name}
                maxLength={120}
                disabled={busy}
                readOnly={frozenRecord !== undefined}
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
                disabled={busy}
                readOnly={frozenRecord !== undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">Leave both blank to stay anonymous.</p>
          </div>
          {frozenRecord !== undefined && (
            <p className="text-sm text-muted-foreground">
              This submission is saved for retry. Answers and contact details are read-only until it
              finishes. Start a new submission to give different feedback.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border p-3">
              {error}
            </p>
          )}
          {goneReason && (
            <section
              role="alert"
              aria-labelledby="feedback-recordings-heading"
              className="space-y-3 rounded-lg border p-3"
            >
              <h2 id="feedback-recordings-heading" className="font-semibold">
                Recordings can't be sent
              </h2>
              <p>{goneReason}</p>
              <div className="flex flex-wrap gap-3">
                <Button disabled={locked} onClick={() => void submitWithoutRecordings()}>
                  Submit without recordings
                </Button>
                <Button variant="outline" disabled={locked} onClick={recordAgain}>
                  Remove recordings and record again
                </Button>
              </div>
            </section>
          )}
          {confirmingNew && (
            <section
              role="alert"
              aria-labelledby="feedback-new-heading"
              className="space-y-3 rounded-lg border p-3"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                setConfirmingNew(false);
                startNewButton.current?.focus();
              }}
            >
              <h2
                id="feedback-new-heading"
                tabIndex={-1}
                ref={newHeading}
                className="font-semibold"
              >
                Discard this submission?
              </h2>
              <p>
                Starting a new submission permanently removes your answers, contact details and
                recordings from this page. If it may already have reached the team, they keep that
                copy. Download first if you want your own.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" disabled={locked} onClick={() => void download()}>
                  Download my feedback first
                </Button>
                <Button disabled={locked} onClick={() => start(pathway)}>
                  Discard and start a new submission
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmingNew(false);
                    startNewButton.current?.focus();
                  }}
                >
                  Keep this submission
                </Button>
              </div>
            </section>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                locked ||
                savingRecordings > 0 ||
                !!goneReason ||
                (messages.length < 2 && !input.trim() && !pending.length)
              }
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
            {frozenRecord !== undefined && (
              <Button
                ref={startNewButton}
                variant="outline"
                disabled={locked || savingRecordings > 0}
                onClick={() => setConfirmingNew(true)}
              >
                Start a new submission
              </Button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
