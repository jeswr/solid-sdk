// AUTHORED-BY Claude Opus 5.5
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  moveStep,
  ONBOARDING_STATES,
  ONBOARDING_STEPS,
  onboardingFinished,
  stepCounter,
  storageHost,
} from "../src/shell/lib/onboarding";
import {
  parseRegistrationFixture,
  REGISTRATION_FIXTURE_KEY,
  registrationAvailable,
} from "../src/shell/lib/registration-fixture";
import {
  displayNameFromUsername,
  isValidUsername,
  PASSWORD_MIN,
  passwordStrength,
  USERNAME_MAX,
  usernameProblem,
  usernameRules,
  usernameStatus,
} from "../src/shell/lib/registration-rules";
import {
  activeStep,
  completedProgress,
  initialProgress,
  progressAnnouncement,
  progressReducer,
  REGISTRATION_STEP_IDS,
  type RegistrationProgress,
  stepFailureMessage,
  stepLabel,
  stepStatusText,
} from "../src/shell/lib/registration-steps";
import { parsePreferences } from "../src/shell/lib/settings-preferences";
import {
  DEMO_REGISTRATION_NOTICE,
  DEMO_RESERVED_USERNAMES,
  DemoRegistrationBackend,
} from "../src/shell/registration/demo-backend";
import { RegistrationError, type RegistrationRequest } from "../src/shell/registration/types";

const signal = () => new AbortController().signal;
const request = (username = "sam-river"): RegistrationRequest => ({
  username,
  displayName: "Sam River",
  method: "password",
  password: "correct horse battery staple",
});

describe("username rules", () => {
  it("reports each rule as met or not", () => {
    expect(usernameRules("").map((rule) => rule.met)).toEqual([false, false, false]);
    expect(usernameRules("ab").map((rule) => rule.met)).toEqual([false, true, true]);
    expect(usernameRules("sam-river-2").map((rule) => rule.met)).toEqual([true, true, true]);
    expect(usernameRules("Sam").map((rule) => rule.met)).toEqual([true, false, false]);
    expect(usernameRules("a".repeat(USERNAME_MAX + 1)).map((rule) => rule.met)).toEqual([
      false,
      true,
      true,
    ]);
    expect(usernameRules("x").map((rule) => rule.label)).toEqual([
      "3–30 characters",
      "Lowercase letters, numbers and hyphens only",
      "Starts and ends with a letter or number",
    ]);
  });
  it("validates and explains the first broken rule", () => {
    expect(isValidUsername("sam")).toBe(true);
    expect(isValidUsername("sam river")).toBe(false);
    expect(usernameProblem("")).toBe("Choose a username.");
    expect(usernameProblem("ab")).toBe("Use at least 3 characters.");
    expect(usernameProblem("a".repeat(31))).toBe("Use 30 characters or fewer.");
    expect(usernameProblem("Sam!")).toBe("Use only lowercase letters, numbers and hyphens.");
    for (const name of ["-sam", "sam-", "---"])
      expect(usernameProblem(name)).toBe("Start and end with a letter or number.");
    expect(usernameProblem("sam-river")).toBeNull();
    expect(usernameProblem("sam")).toBeNull();
  });
  it("prefills a display name from the username", () => {
    expect(displayNameFromUsername("sam-river-2")).toBe("Sam River 2");
    expect(displayNameFromUsername("--ana--")).toBe("Ana");
    expect(displayNameFromUsername("")).toBe("");
  });
  it("describes the live status for every check state", () => {
    expect(usernameStatus("", "available")).toBe("");
    expect(usernameStatus("ab", "available")).toBe("Use at least 3 characters.");
    expect(usernameStatus("sam", "idle")).toBe("");
    expect(usernameStatus("sam", "checking")).toBe("Checking whether sam is free…");
    expect(usernameStatus("sam", "available")).toBe("sam is available.");
    expect(usernameStatus("sam", "taken")).toBe("sam is taken. Try another username.");
    expect(usernameStatus("sam", "error")).toBe(
      "We couldn't check this username. You can still try to create your account.",
    );
  });
});

describe("password strength", () => {
  it("requires only length", () => {
    expect(passwordStrength("Short1!")).toEqual({
      score: 0,
      label: "Too short",
      acceptable: false,
    });
    expect(passwordStrength("x".repeat(PASSWORD_MIN - 1)).acceptable).toBe(false);
    expect(passwordStrength("x".repeat(PASSWORD_MIN)).acceptable).toBe(true);
  });
  it("gives repeats and runs no credit", () => {
    expect(passwordStrength("aaaaaaaaaaaa").label).toBe("Weak");
    expect(passwordStrength("abcdefghijkl").label).toBe("Weak");
    expect(passwordStrength("123456789012").label).toBe("Weak");
  });
  it("rewards length and variety", () => {
    expect(passwordStrength("qwzmxkprtvbn").label).toBe("Fair");
    expect(passwordStrength("Qw7!zm-Xk9#p").label).toBe("Good");
    expect(passwordStrength("correct horse battery staple")).toEqual({
      score: 4,
      label: "Strong",
      acceptable: true,
    });
    // Code points, not UTF-16 units: an emoji counts once.
    expect(passwordStrength("🙂".repeat(11)).acceptable).toBe(false);
  });
  it("caps passwords containing the username or name", () => {
    expect(passwordStrength("sam-river correct horse", ["sam-river"]).label).toBe("Weak");
    expect(passwordStrength("Sam River correct horse", ["  sam river "]).label).toBe("Weak");
    // Words shorter than a username are ignored.
    expect(passwordStrength("correct horse battery staple", ["or", ""]).label).toBe("Strong");
  });
});

describe("registration progress", () => {
  const running = progressReducer(initialProgress, { type: "start" });
  it("starts on the pod step and ignores a second start", () => {
    expect(running).toEqual({
      phase: "running",
      steps: { pod: "active", "account-id": "pending", "sign-in": "pending" },
      error: null,
    });
    expect(progressReducer(running, { type: "start" })).toBe(running);
    expect(activeStep(initialProgress)).toBeNull();
    expect(activeStep(running)).toBe("pod");
  });
  it("advances step by step to done", () => {
    const second = progressReducer(running, { type: "succeeded", step: "pod" });
    expect(activeStep(second)).toBe("account-id");
    expect(second.steps.pod).toBe("done");
    expect(progressReducer(second, { type: "succeeded", step: "pod" })).toBe(second);
    expect(progressReducer(initialProgress, { type: "succeeded", step: "pod" })).toBe(
      initialProgress,
    );
    const third = progressReducer(second, { type: "succeeded", step: "account-id" });
    const done = progressReducer(third, { type: "succeeded", step: "sign-in" });
    expect(done).toEqual({
      phase: "done",
      steps: { pod: "done", "account-id": "done", "sign-in": "done" },
      error: null,
    });
    expect(done).toEqual(completedProgress);
    expect(progressAnnouncement(done)).toBe("Your account is ready.");
  });
  it("fails one step and retries only that step", () => {
    const second = progressReducer(running, { type: "succeeded", step: "pod" });
    expect(progressReducer(second, { type: "failed", step: "pod", message: "x" })).toBe(second);
    const failed = progressReducer(second, {
      type: "failed",
      step: "account-id",
      message: "Nope",
    });
    expect(failed).toEqual({
      phase: "failed",
      steps: { pod: "done", "account-id": "failed", "sign-in": "pending" },
      error: { step: "account-id", message: "Nope" },
    });
    expect(progressAnnouncement(failed)).toBe("Creating your account ID didn't finish.");
    expect(progressReducer(failed, { type: "failed", step: "account-id", message: "x" })).toBe(
      failed,
    );
    const retried = progressReducer(failed, { type: "retry" });
    expect(retried).toEqual({
      phase: "running",
      steps: { pod: "done", "account-id": "active", "sign-in": "pending" },
      error: null,
    });
    expect(progressAnnouncement(retried)).toBe("Creating your account ID…");
    expect(progressReducer(running, { type: "retry" })).toBe(running);
    const broken: RegistrationProgress = { ...failed, error: null };
    expect(progressReducer(broken, { type: "retry" })).toBe(broken);
    expect(progressAnnouncement(broken)).toBe("");
    expect(progressReducer(failed, { type: "reset" })).toBe(initialProgress);
    expect(progressAnnouncement(initialProgress)).toBe("");
  });
  it("labels steps and statuses in plain words", () => {
    expect(REGISTRATION_STEP_IDS.map(stepLabel)).toEqual([
      "Creating your pod",
      "Creating your account ID",
      "Signing you in",
    ]);
    expect((["pending", "active", "done", "failed"] as const).map(stepStatusText)).toEqual([
      "Not started",
      "In progress",
      "Done",
      "Didn't finish",
    ]);
    expect(REGISTRATION_STEP_IDS.map(stepFailureMessage)).toEqual([
      "We couldn't create your pod. Please try again.",
      "We couldn't create your account ID. Please try again.",
      "Your account is ready, but we couldn't sign you in. Please try again.",
    ]);
  });
});

describe("registration availability and the fixture override", () => {
  const none = { available: false, failOnce: [] };
  it("parses the override defensively", () => {
    expect(REGISTRATION_FIXTURE_KEY).toBe("suite.test.registration.v1");
    expect(parseRegistrationFixture(null)).toEqual(none);
    expect(parseRegistrationFixture("{")).toEqual(none);
    expect(parseRegistrationFixture("[]")).toEqual(none);
    expect(
      parseRegistrationFixture('{"available":true,"failOnce":["sign-in","pod","surprise"]}'),
    ).toEqual({ available: true, failOnce: ["pod", "sign-in"] });
    expect(parseRegistrationFixture('{"available":"yes","failOnce":"pod"}')).toEqual(none);
  });
  it("needs the flag or the override, and a backend", () => {
    const on = { available: true, failOnce: [] };
    expect(registrationAvailable({ selfRegistration: true, fixture: none, demo: true })).toBe(true);
    expect(registrationAvailable({ selfRegistration: undefined, fixture: on, demo: true })).toBe(
      true,
    );
    expect(registrationAvailable({ selfRegistration: false, fixture: none, demo: true })).toBe(
      false,
    );
    expect(registrationAvailable({ selfRegistration: true, fixture: on, demo: false })).toBe(false);
  });
});

describe("onboarding", () => {
  it("is finished once complete or skipped", () => {
    expect(ONBOARDING_STATES.map(onboardingFinished)).toEqual([false, true, true]);
  });
  it("stores its state in the account preferences", () => {
    expect(parsePreferences(null).onboarding).toBe("not-started");
    for (const state of ONBOARDING_STATES)
      expect(parsePreferences(JSON.stringify({ onboarding: state })).onboarding).toBe(state);
    expect(parsePreferences('{"onboarding":"maybe"}').onboarding).toBe("not-started");
  });
  it("moves within three steps", () => {
    expect(ONBOARDING_STEPS.map((step) => step.title)).toEqual([
      "This is your pod",
      "Make it yours",
      "Bring your data",
    ]);
    expect(moveStep(0, -1)).toBe(0);
    expect(moveStep(0, 1)).toBe(1);
    expect(moveStep(2, 1)).toBe(2);
    expect(moveStep(2, -1)).toBe(1);
    expect(stepCounter(1)).toBe("Step 2 of 3");
  });
  it("shows the storage host", () => {
    expect(storageHost("https://sam.example.org/pod/")).toBe("sam.example.org");
    expect(storageHost("not a url")).toBe("not a url");
  });
});

describe("demo registration backend", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("previews fictional addresses and explains itself", () => {
    const backend = new DemoRegistrationBackend({ delayMs: 0 });
    expect(backend.previewUrls("sam")).toEqual({
      pod: "https://sam.demo.example.org/",
      accountId: "https://sam.demo.example.org/profile/card#me",
    });
    expect(backend.methods).toEqual(["password"]);
    expect(backend.notice).toBe(DEMO_REGISTRATION_NOTICE);
  });
  it("checks usernames against reserved and created names", async () => {
    const backend = new DemoRegistrationBackend({ delayMs: 0 });
    for (const name of DEMO_RESERVED_USERNAMES)
      await expect(backend.checkUsername(name, signal())).resolves.toBe("taken");
    await expect(backend.checkUsername("sam-river", signal())).resolves.toBe("available");
    await expect(backend.createPod(request(), signal())).resolves.toEqual({
      podUrl: "https://sam-river.demo.example.org/",
    });
    await expect(backend.checkUsername("sam-river", signal())).resolves.toBe("taken");
    // Retrying a pod step that already finished is safe.
    await expect(backend.createPod(request(), signal())).resolves.toEqual({
      podUrl: "https://sam-river.demo.example.org/",
    });
    await expect(backend.createPod(request("alice"), signal())).rejects.toMatchObject({
      name: "RegistrationError",
      step: "pod",
      message: "That username was taken a moment ago. Change your details and choose another.",
    });
  });
  it("waits by default and honours cancellation", async () => {
    vi.useFakeTimers();
    const backend = new DemoRegistrationBackend();
    const pending = backend.checkUsername("sam", signal());
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBe("available");
    const controller = new AbortController();
    const cancelled = backend.createPod(request(), controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    await expect(backend.checkUsername("sam", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs the three steps, failing a chosen step once", async () => {
    const backend = new DemoRegistrationBackend({
      delayMs: 0,
      failOnce: ["pod", "account-id", "sign-in"],
    });
    const sam = request();
    await expect(backend.createPod(sam, signal())).rejects.toEqual(
      new RegistrationError("pod", stepFailureMessage("pod")),
    );
    const { podUrl } = await backend.createPod(sam, signal());
    await expect(backend.createAccountId(sam, { podUrl }, signal())).rejects.toMatchObject({
      step: "account-id",
    });
    await expect(backend.createAccountId(sam, {}, signal())).rejects.toMatchObject({
      step: "account-id",
      message: stepFailureMessage("account-id"),
    });
    const { accountId } = await backend.createAccountId(sam, { podUrl }, signal());
    expect(accountId).toBe("https://sam-river.demo.example.org/profile/card#me");
    await expect(backend.signIn(sam, { podUrl, accountId }, signal())).rejects.toMatchObject({
      step: "sign-in",
    });
    await expect(backend.signIn(sam, { podUrl }, signal())).rejects.toMatchObject({
      step: "sign-in",
    });
    await expect(backend.signIn(sam, { podUrl, accountId }, signal())).resolves.toEqual({
      kind: "demo",
      hint: { webId: accountId },
    });
  });
});
