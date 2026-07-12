// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initials, JeswrAccountMenu } from "../src/components/account-menu.js";

async function mount(attrs: Record<string, string> = {}): Promise<JeswrAccountMenu> {
  const el = document.createElement("jeswr-account-menu") as JeswrAccountMenu;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initials", () => {
  it("computes two-letter uppercase initials", () => {
    expect(initials("Jesse Wright")).toBe("JW");
    expect(initials("madonna")).toBe("MA");
    expect(initials("  Ada  Lovelace ")).toBe("AL");
    expect(initials("A B C D")).toBe("AD");
    expect(initials("")).toBe("?");
  });
});

describe("<jeswr-account-menu>", () => {
  it("registers under the jeswr- prefix", () => {
    expect(customElements.get("jeswr-account-menu")).toBe(JeswrAccountMenu);
  });

  it("maps the webid/name/avatar-url attributes to props", async () => {
    const el = await mount({
      webid: "https://id.example/me#me",
      name: "Ada Lovelace",
      "avatar-url": "https://img.example/a.png",
    });
    expect(el.webId).toBe("https://id.example/me#me");
    expect(el.name).toBe("Ada Lovelace");
    expect(el.avatarUrl).toBe("https://img.example/a.png");
  });

  it("shows an avatar image when avatar-url is set", async () => {
    const el = await mount({ name: "Ada", "avatar-url": "https://img.example/a.png" });
    const img = el.shadowRoot?.querySelector(".avatar img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://img.example/a.png");
  });

  it("falls back to initials when no avatar image", async () => {
    const el = await mount({ name: "Ada Lovelace" });
    const avatar = el.shadowRoot?.querySelector(".avatar");
    expect(avatar?.textContent?.trim()).toBe("AL");
  });

  it("opens the menu and shows the WebID under the name", async () => {
    const el = await mount({ name: "Ada", webid: "https://id.example/me" });
    const trigger = el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement;
    trigger.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".menu")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".identity-webid")?.textContent).toBe(
      "https://id.example/me",
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders slotted extra menu items", async () => {
    const el = document.createElement("jeswr-account-menu") as JeswrAccountMenu;
    el.setAttribute("name", "Ada");
    const item = document.createElement("button");
    item.textContent = "Profile";
    el.appendChild(item);
    document.body.appendChild(el);
    await el.updateComplete;
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const slot = el.shadowRoot?.querySelector("slot") as HTMLSlotElement;
    const assigned = slot.assignedElements();
    expect(assigned).toContain(item);
  });

  it("closes on an outside pointerdown AND removes the document listener (no leak)", async () => {
    const el = await mount({ name: "Ada" });
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    // Open: registers exactly one document-level pointerdown listener.
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".menu")).not.toBeNull();
    const pointerAdds = addSpy.mock.calls.filter(([type]) => type === "pointerdown");
    expect(pointerAdds.length).toBe(1);

    // Click OUTSIDE the element: closes the menu AND tears down the listener in
    // the same branch (the leak the roborev finding flagged).
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".menu")).toBeNull();
    const pointerRemoves = removeSpy.mock.calls.filter(([type]) => type === "pointerdown");
    expect(pointerRemoves.length).toBeGreaterThanOrEqual(1);
  });

  it("emits sign-out on the sign-out action and closes", async () => {
    const el = await mount({ name: "Ada" });
    (el.shadowRoot?.querySelector(".trigger") as HTMLButtonElement).click();
    await el.updateComplete;
    const fired = new Promise<void>((resolve) => {
      el.addEventListener("sign-out", () => resolve(), { once: true });
    });
    (el.shadowRoot?.querySelector(".item") as HTMLButtonElement).click();
    await fired;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".menu")).toBeNull();
  });
});
