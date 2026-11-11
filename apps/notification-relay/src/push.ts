// AUTHORED-BY Codex GPT-6
import { randomBytes } from "node:crypto";
import { matchesHash, sha256, verifyDeviceProof } from "./device-proof.js";
import {
  expireRegistrations,
  type Installation,
  type PushState,
  removeRegistration,
} from "./push-state.js";
import {
  installationInput,
  installationPatch,
  object,
  PushError,
  parseBody,
  pushBody,
  registrationInput,
  requirePush,
} from "./push-validation.js";
import type { ResourceIdentity } from "./resource-auth.js";
import type { RelayStore } from "./store.js";

export interface ChallengePayload {
  v: 1;
  id: string;
  kind: "challenge";
  nonce: string;
  sentAt: number;
}
/** P2b encrypts payloads and supplies FCM/APNs transports. No webhook delivery here. */
export interface PushSink {
  send(installation: Installation, payload: ChallengePayload): Promise<void>;
}
const lifetime = 30 * 86_400_000;
const randomId = () => randomBytes(16).toString("hex");
const keyId = (installation: Installation) =>
  JSON.stringify([installation.deviceSigningKey.x, installation.deviceSigningKey.y]);

export function createPushApi(options: {
  publicOrigin: string;
  store: RelayStore;
  now: () => number;
  authorize: (request: Request) => Promise<ResourceIdentity>;
  pushSink?: PushSink;
  allowLoopback?: boolean;
}) {
  const { store, now, publicOrigin } = options;
  function transaction<T>(operation: (state: PushState, at: number) => T) {
    const at = now();
    return store.transaction((state) => {
      expireRegistrations(state, at);
      return operation(state, at);
    });
  }
  async function proof(request: Request, body: Buffer, installation: Installation) {
    try {
      await verifyDeviceProof({
        request,
        body,
        key: installation.deviceSigningKey,
        publicOrigin,
        now: now(),
        store,
      });
    } catch {
      throw new PushError(401);
    }
  }
  function current(state: PushState, checked: Installation) {
    const live = state.installations.get(checked.installationId);
    // A key/token rotation or deletion during async verification invalidates this operation.
    requirePush(
      live && live.tokenVersion === checked.tokenVersion && keyId(live) === keyId(checked),
      401,
    );
    return live;
  }
  async function challenge(installation: Installation, nonce: string): Promise<boolean> {
    try {
      // The only sink call in this part is a challenge, including while inactive.
      await (options.pushSink as PushSink).send(installation, {
        v: 1,
        id: randomId(),
        kind: "challenge",
        nonce,
        sentAt: now(),
      });
      return true;
    } catch {
      return false;
    }
  }
  const inbox = (id: string, secret: string) => `${publicOrigin}/inbox/${id}/${secret}`;

  return {
    /** Periodic sweep as well as request-time expiry; deletion always shares the transaction. */
    async expire(): Promise<void> {
      await transaction(() => undefined);
    },
    async handle(request: Request, headers: Headers): Promise<Response> {
      const respond = (status: number, data?: unknown) => {
        if (status === 401) headers.set("www-authenticate", "DPoP");
        if (data !== undefined) headers.set("content-type", "application/json");
        return new Response(data === undefined ? null : JSON.stringify(data), { status, headers });
      };
      try {
        const url = new URL(request.url);
        const route =
          /^\/push\/(installations|registrations)(?:\/([\w-]{1,128})(?:\/(activate|rotate-inbox))?)?$/u.exec(
            url.pathname,
          );
        if (!route || url.search || url.hash) return respond(404);
        const [, kind, id, action] = route;
        const method = request.method;
        const create = kind === "installations" && !id && method === "POST";
        const patch = kind === "installations" && id && !action && method === "PATCH";
        const activate =
          kind === "installations" && id && action === "activate" && method === "POST";
        const put = kind === "registrations" && id && !action && method === "PUT";
        const rotate =
          kind === "registrations" && id && action === "rotate-inbox" && method === "POST";
        const cleanup = id && !action && method === "DELETE";
        if (!(create || patch || activate || put || rotate || cleanup)) return respond(404);
        let identity: ResourceIdentity | undefined;
        if (!cleanup || (kind === "registrations" && request.headers.has("authorization"))) {
          try {
            identity = await options.authorize(request);
          } catch {
            requirePush(cleanup, 401);
          }
        }
        let body: Buffer;
        let json: unknown;
        try {
          body = await pushBody(request, Boolean(cleanup || rotate));
          json = body.length ? parseBody(body) : {};
          if (cleanup || rotate) object(json, []);
        } catch (error) {
          if (error instanceof PushError) throw error;
          throw new PushError(400);
        }
        if (create) {
          let input: ReturnType<typeof installationInput>;
          try {
            input = installationInput(json);
          } catch {
            throw new PushError(400);
          }
          requirePush(options.pushSink, 503);
          const nonce = randomBytes(16).toString("base64url");
          const installation: Installation = {
            ...input,
            installationId: randomId(),
            tokenVersion: 1,
            activated: false,
            challengeHash: sha256(nonce),
            challengeAttempts: [now()],
          };
          await proof(request, body, installation);
          await transaction((state) => {
            state.installations.set(installation.installationId, installation);
          });
          return respond(201, {
            installationId: installation.installationId,
            activated: false,
            challengeSent: await challenge(installation, nonce),
          });
        }
        // Snapshot is never authoritative for a write: recheck ownership and keys in the commit.
        const snapshot = await transaction((state) => ({
          installation: state.installations.get(id as string),
          registration: state.registrations.get(id as string),
        }));
        if (kind === "installations") {
          const installation = snapshot.installation;
          requirePush(installation, 404);
          await proof(request, body, installation);
          if (cleanup) {
            await transaction((state) => {
              current(state, installation);
              for (const [registrationId, registration] of state.registrations)
                if (registration.installationId === id) state.registrations.delete(registrationId);
              state.installations.delete(id as string);
            });
            return respond(204);
          }
          if (activate) {
            const activation = object(json, ["nonce"]);
            requirePush(typeof activation.nonce === "string");
            await transaction((state) => {
              const live = current(state, installation);
              requirePush(
                !live.activated && matchesHash(activation.nonce as string, live.challengeHash),
                401,
              );
              live.activated = true;
              live.challengeHash = "";
            });
            return respond(204);
          }
          let changes: ReturnType<typeof installationPatch>;
          try {
            changes = installationPatch(json);
            installationInput({
              platform: installation.platform,
              pushToken: installation.pushToken,
              devicePublicKey: installation.devicePublicKey,
              authSecret: installation.authSecret,
              deviceSigningKey: installation.deviceSigningKey,
              ...changes,
            });
          } catch {
            throw new PushError(400);
          }
          const nonce = randomBytes(16).toString("base64url");
          const result = await transaction((state, at) => {
            const live = current(state, installation);
            const changed = Object.entries(changes).some(
              ([key, value]) =>
                JSON.stringify(value) !== JSON.stringify(live[key as keyof Installation]),
            );
            if (!changed && live.activated) return { installation: live, send: false };
            requirePush(options.pushSink, 503);
            const attempts = live.challengeAttempts.filter((time) => time > at - 3_600_000);
            requirePush(attempts.length < 3, 429);
            Object.assign(live, changes);
            if (changed) live.tokenVersion++;
            live.activated = false;
            live.challengeHash = sha256(nonce);
            live.challengeAttempts = [...attempts, at];
            return { installation: live, send: true };
          });
          return respond(200, {
            installationId: id,
            activated: result.installation.activated,
            ...(result.send ? { challengeSent: await challenge(result.installation, nonce) } : {}),
          });
        }
        if (put) {
          let input: ReturnType<typeof registrationInput>;
          try {
            input = registrationInput(json, options.allowLoopback);
          } catch {
            throw new PushError(400);
          }
          requirePush((identity as ResourceIdentity).webid === input.webId, 401);
          const previous = snapshot.registration;
          if (previous) requirePush(previous.webId === (identity as ResourceIdentity).webid, 401);
          const attaching = !previous || previous.installationId !== input.installationId;
          const installation = await transaction((state) =>
            state.installations.get(input.installationId),
          );
          requirePush(installation, 404);
          if (attaching) await proof(request, body, installation);
          const secret = randomBytes(32).toString("base64url");
          const created = await transaction((state, at) => {
            current(state, installation);
            const live = state.registrations.get(id as string);
            // A concurrent attachment/refresh must not turn a token-only request into a move.
            requirePush(
              live?.installationId === previous?.installationId && live?.webId === previous?.webId,
              409,
            );
            const count = [...state.registrations.values()].filter(
              (other) =>
                other.installationId === input.installationId && other.registrationId !== id,
            ).length;
            requirePush(count < 4, 409);
            if (live && live.installationId !== input.installationId)
              removeRegistration(state, id as string);
            state.registrations.set(id as string, {
              ...input,
              registrationId: id as string,
              expiresAt: at + lifetime,
              inboxSecretHash: live?.inboxSecretHash ?? sha256(secret),
            });
            return !live;
          });
          return respond(created ? 201 : 200, {
            registrationId: id,
            ...(created ? { inbox: inbox(id as string, secret) } : {}),
          });
        }
        const registration = snapshot.registration;
        requirePush(registration, 404);
        const tokenOwns = identity?.webid === registration.webId;
        let checked: Installation | undefined;
        if (cleanup && !tokenOwns) {
          checked = await transaction((state) =>
            state.installations.get(registration.installationId),
          );
          requirePush(checked, 404);
          await proof(request, body, checked);
        } else requirePush(tokenOwns, 401);
        const secret = randomBytes(32).toString("base64url");
        await transaction((state) => {
          const live = state.registrations.get(id as string);
          requirePush(
            live &&
              live.webId === registration.webId &&
              live.installationId === registration.installationId,
            409,
          );
          if (checked) current(state, checked);
          if (cleanup) removeRegistration(state, id as string);
          else live.inboxSecretHash = sha256(secret);
        });
        return cleanup ? respond(204) : respond(200, { inbox: inbox(id as string, secret) });
      } catch (error) {
        return respond(error instanceof PushError ? error.status : 503);
      }
    },
  };
}
