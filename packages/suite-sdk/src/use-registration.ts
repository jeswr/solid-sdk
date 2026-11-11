// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { Identity } from "@jeswr/pod-auth";
import { usePodAuth } from "@jeswr/pod-auth/react";
import {
  createRegistration,
  type Registration,
  RegistrationError,
  type RegistrationOptions,
} from "@jeswr/pod-auth/registration";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

export type UseRegistrationOptions = Omit<RegistrationOptions, "podAuth">;
export type {
  Registration,
  RegistrationCreated,
  RegistrationErrorCode,
  RegistrationOperationOptions,
  RegistrationPreview,
  RegistrationRequest,
  RegistrationStep,
  UsernameAvailability,
} from "@jeswr/pod-auth/registration";
export { RegistrationError } from "@jeswr/pod-auth/registration";

/** Delegates to the CSS client in the current provider. Retained actions lose authority on commit. */
export function useRegistration(
  options: UseRegistrationOptions = { accountApi: null },
): Registration {
  const { auth, fetch: authenticatedFetch, identity } = usePodAuth();
  const { accountApi, podHost, fetch: publicFetch, allowInsecureLoopback } = options;
  const active = useRef<object | null>(null);
  const [lifecycle, setLifecycle] = useState(0);
  useLayoutEffect(() => {
    const stops = (["login", "restore", "logout", "expired"] as const).map((type) =>
      auth.on(type, () => {
        active.current = null;
        setLifecycle((value) => value + 1);
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [auth]);
  const sessions = useMemo(
    () => ({
      auth,
      authenticatedFetch,
      config: { accountApi, podHost, fetch: publicFetch, allowInsecureLoopback },
      pending: new Set<AbortController>(),
      registering: false,
    }),
    [auth, authenticatedFetch, accountApi, podHost, publicFetch, allowInsecureLoopback],
  );
  const state = useMemo(() => {
    const session = { identity, lifecycle };
    const assertActive = () => {
      if (active.current !== session) throw new Error("Registration session changed");
    };
    const config = sessions.config;
    const client = createRegistration({ ...config, podAuth: auth });
    const action: Registration = {
      methods: client.methods,
      previewUrls: (name) => {
        assertActive();
        return client.previewUrls(name);
      },
      available: async (opts) => {
        assertActive();
        const result = await client.available(opts);
        assertActive();
        return result;
      },
      checkUsername: async (name, opts) => {
        assertActive();
        const result = await client.checkUsername(name, opts);
        assertActive();
        return result;
      },
      register: async (request, opts = {}) => {
        assertActive();
        if (sessions.registering)
          throw new RegistrationError("registration-in-progress", "account");
        const expected = client.previewUrls(request.username).webId;
        sessions.registering = true;
        const controller = new AbortController();
        sessions.pending.add(controller);
        const signal =
          opts.signal === undefined
            ? controller.signal
            : AbortSignal.any([opts.signal, controller.signal]);
        // Registration itself establishes a session. Allow exactly that transition for this run,
        // while revoking its old retained actions and rejecting logout/expiry/unrelated logins.
        let loggingIn = false;
        let established: Identity | null = null;
        const stop = (["login", "restore", "logout", "expired"] as const).map((type) =>
          auth.on(type, (event) => {
            if (type === "login" && loggingIn && event.identity?.webId === expected)
              established = event.identity;
            else controller.abort(new Error("Registration session changed"));
          }),
        );
        const guard = () => {
          signal.throwIfAborted();
          if (established === null) assertActive();
        };
        const scoped =
          (transport: typeof authenticatedFetch): typeof authenticatedFetch =>
          async (input, init) => {
            guard();
            const response = await transport(input, init);
            guard();
            return response;
          };
        const run = createRegistration({
          ...config,
          fetch: scoped(publicFetch ?? globalThis.fetch),
          podAuth: {
            fetch: scoped(authenticatedFetch),
            login: async (hint, loginOptions) => {
              guard();
              loggingIn = true;
              try {
                return await auth.login(hint, loginOptions);
              } finally {
                loggingIn = false;
              }
            },
          },
        });
        try {
          const result = await run.register(request, { ...opts, signal });
          guard();
          return result;
        } finally {
          for (const unsubscribe of stop) unsubscribe();
          sessions.pending.delete(controller);
          sessions.registering = false;
        }
      },
    };
    return { session, action };
  }, [auth, authenticatedFetch, identity, lifecycle, publicFetch, sessions]);
  useLayoutEffect(() => {
    active.current = state.session;
    return () => {
      active.current = null;
    };
  }, [state]);
  useLayoutEffect(
    () => () => {
      for (const controller of sessions.pending)
        controller.abort(new Error("Registration session changed"));
    },
    [sessions],
  );
  return state.action;
}
