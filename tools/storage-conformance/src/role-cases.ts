// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import * as access from "@jeswr/pod-access";
import * as roles from "@jeswr/pod-access/roles";
import {
  addGrant,
  movePreservingAccess,
  type Role,
  type RoleGrant,
  readGrants,
  removeGrant,
  type SetGrantsResult,
  setGrants,
} from "@jeswr/pod-access/roles";
import { container, etag, text } from "./case-helpers.js";
import { expectStorageError } from "./testing.js";
import type { ConformanceCase, RunningTarget, SupportProbe } from "./types.js";

const FRIEND = "https://identity.example/bob#me";
const agent = { type: "webid" as const, id: FRIEND };
const grant = (role: Role): RoleGrant => ({ agent, role, inherited: false, source: "" });

function applied(result: SetGrantsResult, url: string) {
  assert.deepEqual(result.failed, [], "Every role mutation must succeed");
  assert.deepEqual(result.applied, [url]);
}

function options(target: RunningTarget, commentsContainer?: string) {
  return {
    fetch: target.fetch,
    root: target.root,
    webId: target.webId,
    kind: "document" as const,
    ...(commentsContainer ? { commentsContainer } : {}),
  };
}

function lwsAccess(target: RunningTarget) {
  return access.createAccessClient({
    storage: target.storage,
    storageId: target.root,
    identity: () => target.webId,
  });
}

function roundtrip(role: "commenter" | "editor" | "manager"): ConformanceCase {
  return {
    id: `SC-ROLES-${role}`,
    requires: [],
    async run(target) {
      const parent = await container(target, `roles-${role}`);
      const item = await text(target.storage, parent);
      const comments = (
        await target.storage.create(parent, null, {
          name: "comments",
          kind: "container",
        })
      ).url;
      if (target.storage.protocol === "lws") {
        const client = lwsAccess(target);
        assert.equal(client.model(), "odrl-grants");
        // SDK-APP-04 explicitly defines manager as unsupported for ODRL grants.
        if (role === "manager") {
          await expectStorageError(
            client.share(
              item.url,
              {
                agent: FRIEND,
                modes: ["read", "write", "append", "control"],
              },
              {},
            ),
            "unsupported",
          );
          assert.equal((await client.grants(item.url)).length, 0);
          return;
        }
        const modes: access.AccessMode[] =
          role === "editor" ? ["read", "write", "append"] : ["read"];
        const shared = await client.share(item.url, { agent: FRIEND, modes }, {});
        assert(shared.id);
        assert(
          (await client.grants(item.url)).some(
            (entry) =>
              entry.agent === FRIEND &&
              new Set(entry.modes).size === modes.length &&
              modes.every((mode) => entry.modes.includes(mode)),
          ),
        );
        if (role === "commenter") {
          await client.share(comments, { agent: FRIEND, modes: ["append"] }, {});
          assert(
            (await client.grants(comments)).some(
              (entry) =>
                entry.agent === FRIEND && entry.modes.length === 1 && entry.modes[0] === "append",
            ),
          );
          await client.revoke(comments, FRIEND);
          assert.equal((await client.grants(comments)).length, 0);
        }
        await client.revoke(item.url, shared.id);
        assert.equal((await client.grants(item.url)).length, 0);
        return;
      }
      const opts = options(target, comments);
      const before = await readGrants(item.url, opts);
      applied(await addGrant([item.url], grant(role), opts), item.url);
      const snapshot = await readGrants(item.url, opts);
      const direct = snapshot.grants.find(
        (entry) => entry.agent.type === "webid" && entry.agent.id === FRIEND && !entry.inherited,
      );
      assert.equal(direct?.role, role);
      assert(direct?.source && target.storage.isWithinStorage(direct.source));
      assert(
        snapshot.grants.some(
          (entry) =>
            entry.agent.type === "webid" &&
            entry.agent.id === target.webId &&
            entry.role === "manager",
        ),
      );
      const version = snapshot.version;
      applied(await addGrant([item.url], grant(role), opts), item.url);
      assert.equal(
        (await readGrants(item.url, opts)).version,
        version,
        "Add replay must not write",
      );
      applied(
        await setGrants([item.url], snapshot.grants, {
          ...opts,
          expected: JSON.parse(JSON.stringify(snapshot)),
        }),
        item.url,
      );
      assert.equal(
        (await readGrants(item.url, opts)).version,
        version,
        "Set replay must not write",
      );
      const stale = await setGrants([item.url], before.grants, { ...opts, expected: before });
      assert.equal(stale.applied.length, 0);
      assert(roles.isRoleError(stale.failed[0]?.error));
      assert.equal(stale.failed[0].error.code, "conflict");
      applied(await removeGrant([item.url], agent, opts), item.url);
      assert(
        !(await readGrants(item.url, opts)).grants.some(
          (entry) => entry.agent.type === "webid" && entry.agent.id === FRIEND,
        ),
      );
      applied(await removeGrant([item.url], agent, opts), item.url);
    },
  };
}

const inherited: ConformanceCase = {
  id: "SC-ROLES-inherited",
  requires: [],
  async run(target) {
    const parent = await container(target, "roles-inherited");
    const item = await text(target.storage, parent);
    if (target.storage.protocol === "lws") {
      const client = lwsAccess(target);
      await expectStorageError(
        client.share(
          parent,
          { agent: FRIEND, modes: ["read"] },
          {
            inherit: true,
          },
        ),
        "unsupported",
      );
      assert.equal((await client.grants(parent)).length, 0);
      assert.equal((await client.grants(item.url)).length, 0);
      return;
    }
    // Seed a governing parent policy through the public typed writer and advertised endpoint.
    const head = await target.storage.head(parent);
    const own = head.links.get("acl")?.[0]?.target;
    assert(own && target.storage.isWithinStorage(own));
    const model = target.accessModel ?? "wac";
    const policy: access.EffectivePolicy = {
      grants: [
        {
          modes: new Set(["read", "write", "append", "control"]),
          who: [[{ kind: "agent", webId: target.webId }]],
          except: [],
          appliesTo: "both",
          source: { url: own, node: `${own}#owner` },
        },
        {
          modes: new Set(["read"]),
          who: [[{ kind: "agent", webId: FRIEND }]],
          except: [],
          appliesTo: "members",
          source: { url: own, node: `${own}#friend` },
        },
      ],
      denials: [],
    };
    const body =
      model === "acp"
        ? await access.writeAcp(policy, parent, own, "css")
        : await access.writeWac(policy, parent, own);
    const response = await target.fetch(own, {
      method: "PUT",
      redirect: "error",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
      body,
    });
    await response.body?.cancel();
    assert(response.ok);
    const opts = { ...options(target), kind: "resource" as const };
    const snapshot = await readGrants(item.url, opts);
    assert(
      snapshot.grants.some(
        (entry) =>
          entry.agent.type === "webid" &&
          entry.agent.id === FRIEND &&
          entry.role === "viewer" &&
          entry.inherited &&
          entry.source === own,
      ),
    );
    const parentVersion = await etag(target.storage, own);
    applied(
      await setGrants([item.url], snapshot.grants, { ...opts, expected: snapshot }),
      item.url,
    );
    assert.equal(
      await etag(target.storage, own),
      parentVersion,
      "Inherited rows must not edit ancestors",
    );
    const removed = await removeGrant([item.url], agent, opts);
    assert(roles.isRoleError(removed.failed[0]?.error));
    assert.equal(removed.failed[0].error.code, "inherited-grant");
  },
};

/** App roles exercise documents, comments and inherited provenance. */
export function roleCases(moveProbe: SupportProbe): readonly ConformanceCase[] {
  const move: ConformanceCase = {
    id: "SC-ROLES-movePreservingAccess",
    // Like the other role cases, access control is exercised on every target; CSS does not
    // advertise the accessControl feature, so requiring it would misreport a missing claim.
    requires: ["move"],
    checks: { move: moveProbe },
    async run(target) {
      const parent = await container(target, "roles-move-source");
      const destination = await container(target, "roles-move-destination");
      const item = await text(target.storage, parent);
      const opts = options(target);
      if (target.storage.protocol === "lws") {
        await lwsAccess(target).share(item.url, { agent: FRIEND, modes: ["read"] }, {});
      } else {
        applied(await addGrant([item.url], grant("viewer"), opts), item.url);
      }
      const result = await movePreservingAccess(target.storage, item.url, destination, {
        ...opts,
        name: "moved.txt",
      });
      assert.equal(result.preserved, true);
      assert.deepEqual(result.dropped, []);
      if (target.storage.protocol === "lws") {
        assert(
          (await lwsAccess(target).grants(result.url)).some(
            (entry) =>
              entry.agent === FRIEND && entry.modes.length === 1 && entry.modes[0] === "read",
          ),
        );
      } else {
        assert(
          (await readGrants(result.url, opts)).grants.some(
            (entry) =>
              entry.agent.type === "webid" &&
              entry.agent.id === FRIEND &&
              entry.role === "viewer" &&
              !entry.inherited,
          ),
        );
      }
      if (!target.storage.features.move.detail.native) assert.notEqual(result.url, item.url);
      const members = [];
      for await (const entry of target.storage.listAll(destination)) members.push(entry.url);
      assert(members.includes(result.url), "Destination listing must contain the moved resource");
      await expectStorageError(target.storage.head(item.url), "not-found");
    },
  };
  return [...(["commenter", "editor", "manager"] as const).map(roundtrip), inherited, move];
}
