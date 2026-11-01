// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * /signup (02-suite-shell §8.2): one progressive form, then the three-step
 * progress panel, then /onboarding. Rendered only when registration is
 * available; otherwise the visitor is sent to /signin with a note.
 */
import {
  Button,
  Checkbox,
  Input,
  Label,
  LoadingSkeleton,
  RadioGroup,
  RadioGroupItem,
} from "@jeswr/suite-ui";
import { Check, Circle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import {
  displayNameFromUsername,
  isValidUsername,
  PASSWORD_MIN,
  passwordStrength,
  type UsernameCheck,
  usernameProblem,
  usernameRules,
  usernameStatus,
} from "../lib/registration-rules";
import {
  activeStep,
  completedProgress,
  initialProgress,
  progressReducer,
  stepFailureMessage,
} from "../lib/registration-steps";
import { useSyncSnapshot } from "../sync/online";
import { ProgressPanel } from "./progress-panel";
import styles from "./registration.module.css";
import { RegistrationError, type RegistrationMethod, type RegistrationRequest } from "./types";
import {
  clearRegistrationFinished,
  type Registration,
  registrationJustFinished,
  SIGNUP_UNAVAILABLE_PARAM,
  useRegistration,
} from "./use-registration";

export const PRIVACY_PATH = "/privacy";
const CHECK_DEBOUNCE_MS = 400;

const ONBOARDING_PATH = "/onboarding";

export function SignupFlow() {
  const registration = useRegistration();
  const router = useRouter();
  const [finished] = useState(registrationJustFinished);
  useEffect(() => {
    if (finished) {
      clearRegistrationFinished();
      router.replace(ONBOARDING_PATH);
    } else if (registration.ready && !registration.available)
      router.replace(`/signin?${SIGNUP_UNAVAILABLE_PARAM}=unavailable`);
  }, [finished, registration.ready, registration.available, router]);
  if (finished)
    return (
      <>
        <h1 className={styles.title}>Create your account</h1>
        <ProgressPanel progress={completedProgress} onRetry={() => {}} onChangeDetails={() => {}} />
      </>
    );
  if (!registration.ready || !registration.available)
    return <LoadingSkeleton preset="detail" count={3} label="Loading account creation" />;
  return <Signup registration={registration} />;
}

type Field = "username" | "displayName" | "password" | "consent";
type Errors = Partial<Record<Field, string>>;
const FIELD_ORDER: readonly Field[] = ["username", "displayName", "password", "consent"];
const FIELD_ID: Record<Field, string> = {
  username: "signup-username",
  displayName: "signup-display-name",
  password: "signup-password",
  consent: "signup-consent",
};

const describedBy = (...ids: (string | false | null | undefined)[]) =>
  ids.filter((id): id is string => Boolean(id)).join(" ") || undefined;

function Signup({ registration }: { registration: Registration }) {
  const router = useRouter();
  const { online } = useSyncSnapshot();
  const [username, setUsername] = useState("");
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const displayName = nameDraft ?? displayNameFromUsername(username);
  const passkey = registration.methods.includes("passkey");
  const [method, setMethod] = useState<RegistrationMethod>(passkey ? "passkey" : "password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [check, setCheck] = useState<UsernameCheck>("idle");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [request, setRequest] = useState<RegistrationRequest | null>(null);
  const [progress, dispatch] = useReducer(progressReducer, initialProgress);
  const step = activeStep(progress);
  const latest = useRef(registration);
  useEffect(() => {
    latest.current = registration;
  });

  // Live availability, 400ms after typing stops; a newer keystroke cancels the old check.
  useEffect(() => {
    if (!isValidUsername(username)) {
      setCheck("idle");
      return;
    }
    setCheck("checking");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      latest.current.checkUsername(username, controller.signal).then(
        (result) => setCheck(result),
        () => {
          if (!controller.signal.aborted) setCheck("error");
        },
      );
    }, CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  // Each active step runs once; Retry re-activates only the step that failed.
  useEffect(() => {
    if (!step || !request) return;
    const controller = new AbortController();
    latest.current.runStep(step, request, controller.signal).then(
      () => dispatch({ type: "succeeded", step }),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "failed",
          step,
          message: cause instanceof RegistrationError ? cause.message : stepFailureMessage(step),
        });
      },
    );
    return () => controller.abort();
  }, [step, request]);

  useEffect(() => {
    if (progress.phase !== "done") return;
    clearRegistrationFinished();
    router.replace(ONBOARDING_PATH);
  }, [progress.phase, router]);

  const focusField = (field: Field) => document.getElementById(FIELD_ID[field])?.focus();
  const clearError = (field: Field) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !online) return;
    const found: Errors = {};
    const problem = usernameProblem(username);
    if (problem) found.username = problem;
    if (displayName.trim().length === 0) found.displayName = "Enter a display name.";
    if (method === "password" && !passwordStrength(password).acceptable)
      found.password = `Use at least ${PASSWORD_MIN} characters.`;
    if (!consent) found.consent = "Confirm you've read how your data is stored.";
    let availability = check;
    if (!problem && (check === "idle" || check === "checking")) {
      setSubmitting(true);
      try {
        availability = await registration.checkUsername(username, new AbortController().signal);
      } catch {
        availability = "error";
      }
      setSubmitting(false);
      setCheck(availability);
    }
    if (!problem && availability === "taken")
      found.username = `${username} is taken. Try another username.`;
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      focusField(first);
      return;
    }
    setRequest({
      username,
      displayName: displayName.trim(),
      method,
      ...(method === "password" ? { password } : {}),
    });
    dispatch({ type: "start" });
  };

  const rules = usernameRules(username);
  const status = usernameStatus(username, check);
  const preview = isValidUsername(username) ? registration.previewUrls(username) : null;
  const strength = passwordStrength(password, [username, displayName]);
  const showForm = progress.phase === "idle";

  return (
    <>
      <h1 className={styles.title}>Create your account</h1>
      {registration.notice && <p className="shell-public-note">{registration.notice}</p>}
      <form noValidate className={styles.form} onSubmit={submit} hidden={!showForm}>
        <div className={styles.field}>
          <Label htmlFor={FIELD_ID.username}>Username</Label>
          <Input
            id={FIELD_ID.username}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            aria-invalid={errors.username ? true : undefined}
            aria-describedby={describedBy(
              "signup-username-rules",
              errors.username ? "signup-username-error" : "signup-username-status",
              preview && "signup-username-preview",
            )}
            onChange={(event) => {
              setUsername(event.target.value);
              clearError("username");
            }}
          />
          <ul id="signup-username-rules" className={styles.rules} aria-label="Username rules">
            {rules.map((rule) => (
              <li key={rule.id} data-met={rule.met}>
                {rule.met ? (
                  <Check aria-hidden="true" size={16} />
                ) : (
                  <Circle aria-hidden="true" size={16} />
                )}
                {rule.label}
                <span className="suite-sr-only">{rule.met ? " (met)" : " (not met yet)"}</span>
              </li>
            ))}
          </ul>
          {errors.username ? (
            <p id="signup-username-error" className={styles.error}>
              {errors.username}
            </p>
          ) : (
            <p
              id="signup-username-status"
              role="status"
              className={styles.status}
              data-state={usernameProblem(username) && username ? "invalid" : check}
            >
              {status}
            </p>
          )}
          {preview && (
            <div id="signup-username-preview" className={styles.preview}>
              <p>
                Your pod will be at <span className={styles.url}>{preview.pod}</span>
              </p>
              <p>
                Your account ID: <span className={styles.url}>{preview.accountId}</span>
              </p>
            </div>
          )}
        </div>

        <div className={styles.field}>
          <Label htmlFor={FIELD_ID.displayName}>Display name</Label>
          <Input
            id={FIELD_ID.displayName}
            name="displayName"
            autoComplete="name"
            value={displayName}
            aria-invalid={errors.displayName ? true : undefined}
            aria-describedby={describedBy(
              "signup-display-name-hint",
              errors.displayName && "signup-display-name-error",
            )}
            onChange={(event) => {
              setNameDraft(event.target.value);
              clearError("displayName");
            }}
          />
          <p id="signup-display-name-hint" className={styles.hint}>
            How people see you when you share things.
          </p>
          {errors.displayName && (
            <p id="signup-display-name-error" className={styles.error}>
              {errors.displayName}
            </p>
          )}
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Security</legend>
          {passkey && (
            <RadioGroup
              aria-label="How you'll sign in"
              value={method}
              onValueChange={(value) => setMethod(value as RegistrationMethod)}
              className={styles.methods}
            >
              <div className={styles.method}>
                <RadioGroupItem id="signup-method-passkey" value="passkey" />
                <Label htmlFor="signup-method-passkey">Passkey (recommended)</Label>
              </div>
              <div className={styles.method}>
                <RadioGroupItem id="signup-method-password" value="password" />
                <Label htmlFor="signup-method-password">Password</Label>
              </div>
            </RadioGroup>
          )}
          {method === "passkey" ? (
            <p className={styles.hint}>
              Your provider will ask your device to create a passkey. You'll use your fingerprint,
              face or screen lock to sign in.
            </p>
          ) : (
            <div className={styles.field}>
              <Label htmlFor={FIELD_ID.password}>Password</Label>
              <div className={styles.passwordRow}>
                <Input
                  id={FIELD_ID.password}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={describedBy(
                    "signup-password-hint",
                    password && "signup-password-strength",
                    errors.password && "signup-password-error",
                  )}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError("password");
                  }}
                />
                <Button
                  variant="outline"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  Show password
                </Button>
              </div>
              <p id="signup-password-hint" className={styles.hint}>
                At least {PASSWORD_MIN} characters. A few unrelated words make a strong password.
              </p>
              {password && (
                <div className={styles.strength}>
                  <span className={styles.meter} data-score={strength.score} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <span id="signup-password-strength">Password strength: {strength.label}</span>
                </div>
              )}
              {errors.password && (
                <p id="signup-password-error" className={styles.error}>
                  {errors.password}
                </p>
              )}
            </div>
          )}
        </fieldset>

        <div className={styles.field}>
          <div className={styles.consent}>
            <Checkbox
              id={FIELD_ID.consent}
              checked={consent}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={describedBy(errors.consent && "signup-consent-error")}
              onCheckedChange={(value) => {
                setConsent(value === true);
                clearError("consent");
              }}
            />
            <Label htmlFor={FIELD_ID.consent} className={styles.consentLabel}>
              <span>
                I've read{" "}
                <a
                  href={PRIVACY_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby="signup-new-tab"
                >
                  how my data is stored
                </a>
              </span>
            </Label>
            <span id="signup-new-tab" hidden>
              Opens in a new tab
            </span>
          </div>
          {errors.consent && (
            <p id="signup-consent-error" className={styles.error}>
              {errors.consent}
            </p>
          )}
        </div>

        {!online && (
          <p role="status" className={styles.status}>
            You're offline. Reconnect to create your account.
          </p>
        )}
        <Button type="submit" disabled={!online || submitting}>
          Create my account
        </Button>
        <p className="shell-public-footer">
          Already have an account? <a href="/signin">Sign in</a>
        </p>
      </form>
      {!showForm && (
        <ProgressPanel
          progress={progress}
          onRetry={() => dispatch({ type: "retry" })}
          onChangeDetails={() => {
            dispatch({ type: "reset" });
            setRequest(null);
            requestAnimationFrame(() => focusField("username"));
          }}
        />
      )}
    </>
  );
}
