// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar.js";
import { Button } from "../components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Separator } from "../components/ui/separator.js";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../components/ui/sheet.js";
import { hostOf, monogramFor, safeHref, signUpTarget, toneAt } from "./model.js";
import type { SignInCardProps } from "./types.js";

function Progress({
  active,
  label = "Signing in…",
  children,
}: {
  active: boolean;
  label?: string;
  children: ReactNode;
}) {
  return active ? (
    <span className="su-sign-in-progress">
      <LoaderCircle
        className="su-sign-in-spinner"
        size={20}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  ) : (
    children
  );
}

export function SignInCard({
  title = "Sign in",
  subtitle = "Use your Solid account to continue.",
  recentAccounts = [],
  providers,
  recentProviders = [],
  allowCustomProvider = true,
  defaultCustomProviderOpen = false,
  pending = null,
  error = null,
  onWebId,
  onProvider,
  onCustomProvider,
  onAccount,
  onCancel,
  footer,
  webIdHelpHref,
}: SignInCardProps) {
  const id = useId();
  const [webId, setWebId] = useState("");
  const [customProvider, setCustomProvider] = useState("");
  const [customOpen, setCustomOpen] = useState(defaultCustomProviderOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lastInput, setLastInput] = useState<"webid" | "custom" | null>("webid");
  const customRef = useRef<HTMLInputElement>(null);
  const busy = pending !== null;
  const expanded = customOpen || pending?.kind === "custom";
  const errorInput = pending
    ? pending.kind === "webid" || pending.kind === "custom"
      ? pending.kind
      : null
    : lastInput;
  const webIdError = !!error && errorInput === "webid";
  const customError = !!error && errorInput === "custom";
  const signUp = signUpTarget(providers);
  const helpHref = safeHref(webIdHelpHref, true);

  useEffect(() => {
    if (customOpen && allowCustomProvider) customRef.current?.focus();
  }, [customOpen, allowCustomProvider]);

  return (
    <section className="su-sign-in-card" aria-labelledby={`${id}-title`}>
      <header className="su-sign-in-stack">
        <h2 className="su-sign-in-title" id={`${id}-title`}>
          {title}
        </h2>
        <p className="su-sign-in-muted">{subtitle}</p>
      </header>

      {recentAccounts.length > 0 && (
        <section className="su-sign-in-stack" aria-label="Recent accounts">
          {recentAccounts.map((account) => {
            const name = account.name?.trim() || hostOf(account.webId) || "your account";
            const initials = name.split(/\s+/).slice(0, 2).map(monogramFor).join("");
            const active = pending?.kind === "account" && pending.key === account.webId;
            const photoUrl = safeHref(account.photoUrl);
            return (
              <Button
                key={account.webId}
                className="su-sign-in-choice"
                variant="outline"
                disabled={busy}
                aria-busy={active || undefined}
                onClick={() => {
                  if (busy) return;
                  setLastInput(null);
                  onAccount(account);
                }}
              >
                <Avatar className="su-sign-in-avatar" aria-hidden="true">
                  {photoUrl && <AvatarImage src={photoUrl} alt="" />}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <span className="su-sign-in-choice-copy">
                  <Progress active={active} label={`Signing in as ${name}…`}>
                    <span>Continue as {name}</span>
                  </Progress>
                  <span className="su-sign-in-muted">{hostOf(account.webId)}</span>
                </span>
              </Button>
            );
          })}
        </section>
      )}

      <form
        className="su-sign-in-stack"
        aria-labelledby={`${id}-webid-title`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const value = webId.trim();
          if (busy || !value) return;
          setLastInput("webid");
          onWebId(value);
        }}
      >
        <h3 className="su-sign-in-form-title" id={`${id}-webid-title`}>
          Sign in with your WebID
        </h3>
        <Label htmlFor={`${id}-webid`}>Your WebID</Label>
        <Input
          id={`${id}-webid`}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://you.example/profile/card#me"
          value={webId}
          onChange={(event) => setWebId(event.target.value)}
          disabled={busy}
          aria-invalid={webIdError || undefined}
          aria-describedby={`${id}-webid-help${webIdError ? ` ${id}-error` : ""}`}
        />
        <p className="su-sign-in-muted" id={`${id}-webid-help`}>
          Don't know it? Choose your provider below.
        </p>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !webId.trim()}
          aria-busy={pending?.kind === "webid" || undefined}
        >
          <Progress active={pending?.kind === "webid"}>Continue</Progress>
        </Button>
      </form>

      {error && (
        <Alert id={`${id}-error`} variant="destructive" className="su-sign-in-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="su-sign-in-divider">
        <Separator />
        <span className="su-sign-in-muted">or continue with your provider</span>
        <Separator />
      </div>

      <ul className="su-sign-in-stack su-sign-in-providers" aria-label="Providers">
        {providers.map((provider, index) => {
          const active =
            pending?.kind === "provider" &&
            (pending.key === provider.id || pending.key === provider.issuer);
          const iconUrl = safeHref(provider.iconUrl);
          return (
            <li key={provider.id}>
              <Button
                className="su-sign-in-choice"
                variant={index === 0 ? "default" : "outline"}
                disabled={busy}
                aria-busy={active || undefined}
                onClick={() => {
                  if (busy) return;
                  setLastInput(null);
                  onProvider(provider);
                }}
              >
                <span
                  className="su-sign-in-monogram"
                  style={{ backgroundColor: toneAt(index) }}
                  aria-hidden="true"
                >
                  {iconUrl ? (
                    // biome-ignore lint/performance/noImgElement: Optional host-supplied icons need no Next.js image loader.
                    <img src={iconUrl} alt="" />
                  ) : (
                    monogramFor(provider.name)
                  )}
                </span>
                <span className="su-sign-in-choice-copy">
                  <Progress active={active} label={`Signing in with ${provider.name}…`}>
                    <span>{provider.label ?? `Continue with ${provider.name}`}</span>
                  </Progress>
                  {provider.description && (
                    <span className="su-sign-in-muted">{provider.description}</span>
                  )}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>

      {allowCustomProvider && (
        <Collapsible
          className="su-sign-in-stack"
          open={expanded}
          onOpenChange={setCustomOpen}
          disabled={busy}
        >
          <CollapsibleTrigger asChild>
            <Button variant="outline" disabled={busy}>
              <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
              Another provider
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form
              className="su-sign-in-stack"
              aria-label="Sign in with another provider"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const value = customProvider.trim();
                if (busy || !value) return;
                setLastInput("custom");
                onCustomProvider(value);
              }}
            >
              <Label htmlFor={`${id}-provider`}>Provider address</Label>
              <Input
                ref={customRef}
                id={`${id}-provider`}
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://your-provider.example/"
                list={`${id}-recent-providers`}
                value={customProvider}
                onChange={(event) => setCustomProvider(event.target.value)}
                disabled={busy}
                aria-invalid={customError || undefined}
                aria-describedby={customError ? `${id}-error` : undefined}
              />
              <datalist id={`${id}-recent-providers`}>
                {Array.from(new Set(recentProviders)).map((issuer) => (
                  <option key={issuer} value={issuer} />
                ))}
              </datalist>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !customProvider.trim()}
                aria-busy={pending?.kind === "custom" || undefined}
              >
                <Progress active={pending?.kind === "custom"}>Continue</Progress>
              </Button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      )}

      {busy && onCancel && (
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      )}

      <footer className="su-sign-in-stack su-sign-in-footer">
        {signUp && (
          <p>
            New to Solid?{" "}
            <a
              href={busy ? undefined : signUp}
              aria-disabled={busy || undefined}
              tabIndex={busy ? -1 : undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get a pod
            </a>
          </p>
        )}
        {helpHref ? (
          <a
            href={busy ? undefined : helpHref}
            aria-disabled={busy || undefined}
            tabIndex={busy ? -1 : undefined}
            rel="noopener noreferrer"
          >
            What is a WebID?
          </a>
        ) : (
          <Sheet open={helpOpen && !busy} onOpenChange={setHelpOpen}>
            <SheetTrigger asChild>
              <Button variant="link" disabled={busy}>
                What is a WebID?
              </Button>
            </SheetTrigger>
            <SheetContent className="su-sign-in-help" showCloseButton={false}>
              <SheetHeader>
                <SheetTitle>What is a WebID?</SheetTitle>
                <SheetDescription>
                  A WebID is a web address that identifies you. Your provider gave you one when you
                  made your account. You can sign in by choosing your provider instead.
                </SheetDescription>
              </SheetHeader>
              <SheetClose asChild>
                <Button variant="outline">Close</Button>
              </SheetClose>
            </SheetContent>
          </Sheet>
        )}
        {footer && <div inert={busy || undefined}>{footer}</div>}
      </footer>
    </section>
  );
}
