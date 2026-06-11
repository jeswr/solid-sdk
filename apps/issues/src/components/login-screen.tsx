"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSolidSession } from "@/lib/session-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, ArrowRight, CircleDot, Loader2, UserRound, X } from "lucide-react";

const schema = z.object({
  webId: z
    .string()
    .trim()
    .min(1, "Enter your WebID")
    .url("That doesn't look like a URL")
    .refine((v) => v.startsWith("http://") || v.startsWith("https://"), "WebID must be an http(s) URL"),
});
type FormValues = z.infer<typeof schema>;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function LoginScreen() {
  const { login, status, error, recentAccounts, forgetAccount, storageChoices, chooseStorage } = useSolidSession();
  const busy = status === "authenticating";

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { webId: "" },
  });

  const onSubmit = (values: FormValues) => login(values.webId);

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <Card className="relative w-full max-w-md shadow-xl shadow-primary/5">
        <CardHeader className="space-y-3 text-center">
          <div
            aria-hidden
            className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"
          >
            <CircleDot className="size-6" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight">Solid Issues</CardTitle>
          <CardDescription className="text-balance">
            Track issues in your own Solid Pod. Your data stays with you.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {status === "choose-storage" && (
            <section aria-labelledby="storage-heading" className="space-y-2">
              <h2 id="storage-heading" className="text-sm font-medium">
                This WebID has several storages — where should your issues live?
              </h2>
              <ul className="space-y-2">
                {storageChoices.map((url) => (
                  <li key={url}>
                    <button
                      type="button"
                      onClick={() => chooseStorage(url)}
                      className="w-full truncate rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {url}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {status !== "choose-storage" && recentAccounts.length > 0 && (
            <section aria-labelledby="recent-heading" className="space-y-2">
              <h2 id="recent-heading" className="text-sm font-medium text-muted-foreground">
                Continue as
              </h2>
              <ul className="space-y-2">
                {recentAccounts.map((account) => (
                  <li key={account.webId} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => login(account.webId)}
                      disabled={busy}
                      className="flex flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                    >
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary"
                      >
                        {account.displayName ? initials(account.displayName) : <UserRound className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{account.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{account.webId}</span>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Forget ${account.displayName}`}
                      onClick={() => forgetAccount(account.webId)}
                      disabled={busy}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="relative py-1 text-center">
                <span className="bg-card px-2 text-xs text-muted-foreground">or add an account</span>
              </div>
            </section>
          )}

          {status !== "choose-storage" && (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="webId">Your WebID</Label>
              <Input
                id="webId"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://you.solidcommunity.net/profile/card#me"
                aria-invalid={!!form.formState.errors.webId}
                aria-describedby={form.formState.errors.webId ? "webId-error" : undefined}
                disabled={busy}
                {...form.register("webId")}
              />
              {form.formState.errors.webId && (
                <p id="webId-error" className="text-sm text-destructive">
                  {form.formState.errors.webId.message}
                </p>
              )}
            </div>

            {error && status === "error" && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </Button>
          </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            New to Solid?{" "}
            <a
              href="https://solidproject.org/users/get-a-pod"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Get a Pod
            </a>{" "}
            to get started.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
