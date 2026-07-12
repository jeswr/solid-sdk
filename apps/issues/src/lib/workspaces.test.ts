import { describe, it, expect } from "vitest";
import { fakePod } from "./testing/fake-pod";
import { slugify, projectTrackerUrl, listProjects, createProject } from "./workspaces";
import { Repository } from "./repository";

const POD = "http://localhost:3000/alice/";
const WEBID = `${POD}profile/card#me`;
const DEFAULT_TRACKER = `${POD}issue-tracker/tracker.ttl`;

const profileTtl = `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<${WEBID}> pim:storage <${POD}>.`;

describe("slugify", () => {
  it("produces URI-safe kebab slugs (no ':' — breaks ACL matching on some servers)", () => {
    expect(slugify("Website Redesign")).toBe("website-redesign");
    expect(slugify("Q3: Mobile App!!")).toBe("q3-mobile-app");
    expect(slugify("  --Weird   input--  ")).toBe("weird-input");
  });
});

describe("projectTrackerUrl", () => {
  it("places each project in its own container beside the default", () => {
    expect(projectTrackerUrl(POD, "website")).toBe(`${POD}issue-tracker/website/tracker.ttl`);
  });
});

describe("listProjects / createProject", () => {
  it("always includes the default tracker, even with no registrations", async () => {
    const { impl } = fakePod({ [`${POD}profile/card`]: profileTtl });
    expect(await listProjects(WEBID, POD, impl)).toEqual([DEFAULT_TRACKER]);
  });

  it("creates a titled project, registers it, and lists it after the default", async () => {
    const { impl } = fakePod({ [`${POD}profile/card`]: profileTtl });
    const url = await createProject(WEBID, POD, "Website Redesign", impl);
    expect(url).toBe(`${POD}issue-tracker/website-redesign/tracker.ttl`);

    // The tracker config exists and carries the project name.
    const info = await new Repository(url, impl).info();
    expect(info.title).toBe("Website Redesign");

    // Discovery: default first, then registered projects (deduped).
    expect(await listProjects(WEBID, POD, impl)).toEqual([DEFAULT_TRACKER, url]);
  });

  it("rejects a project whose slug already exists", async () => {
    const { impl } = fakePod({ [`${POD}profile/card`]: profileTtl });
    await createProject(WEBID, POD, "Website", impl);
    await expect(createProject(WEBID, POD, "  website ", impl)).rejects.toThrow(/already exists/i);
  });

  it("ignores registrations outside the chosen storage", async () => {
    const { impl, store } = fakePod({ [`${POD}profile/card`]: profileTtl });
    await createProject(WEBID, POD, "Mine", impl);
    // Simulate a stray registration pointing at someone else's pod.
    const index = `${POD}settings/publicTypeIndex.ttl`;
    store.set(
      index,
      store.get(index)! +
        `\n<${index}#stray> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
  <http://www.w3.org/ns/solid/terms#forClass> <http://www.w3.org/2005/01/wf/flow#Tracker>;
  <http://www.w3.org/ns/solid/terms#instance> <http://localhost:3000/bob/issue-tracker/tracker.ttl>.`,
    );
    const projects = await listProjects(WEBID, POD, impl);
    expect(projects).toEqual([DEFAULT_TRACKER, `${POD}issue-tracker/mine/tracker.ttl`]);
  });
});
