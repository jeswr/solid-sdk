// AUTHORED-BY Codex GPT-6.1-Sol
import { type SuiteToken, tokens } from "@jeswr/suite-ui";
import type { CSSProperties } from "react";

const colours = tokens.filter((t) => t.category === "colour");
const sizes = ["xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl"];
const style = (properties: Record<string, string>): CSSProperties => properties as CSSProperties;
function Swatches({ theme }: { theme: "light" | "dark" }) {
  return (
    <section
      style={style(Object.fromEntries(colours.map((token) => [token.name, token[theme]])))}
      className={`palette ${theme}`}
      aria-labelledby={`palette-${theme}`}
    >
      <h2 id={`palette-${theme}`}>{theme === "light" ? "Light" : "Dark"} colours</h2>
      <ul className="swatch-grid">
        {colours.map((token: SuiteToken) => (
          <li key={token.name}>
            <div
              aria-hidden="true"
              className="swatch"
              style={{ background: `var(${token.name})` }}
            />
            <code>{token.name}</code>
            <span className="token-use">{token.use || "Paired foreground"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
export default function TokensPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <nav aria-label="Component fixtures">
        <a href="/dev/components">All component fixtures</a>
      </nav>
      <header className="fixture-heading">
        <p className="eyebrow">Solid Suite · Foundations</p>
        <h1>Tokens</h1>
        <p>Colour, type, space and density. The shared language of the suite.</p>
      </header>
      <div className="palettes">
        <Swatches theme="light" />
        <Swatches theme="dark" />
      </div>
      <section aria-labelledby="typography">
        <h2 id="typography">Typography</h2>
        <div className="foundation-card type-scale">
          {sizes.map((size) => (
            <p
              key={size}
              style={style({
                fontSize: `var(--text-${size})`,
                lineHeight: `var(--lh-${size})`,
                fontWeight: `var(--weight-${size})`,
                letterSpacing: `var(--tracking-${size})`,
              })}
            >
              <code>{size}</code> Your data stays yours.
            </p>
          ))}
        </div>
        <div className="foundation-card">
          <p className="document-type">Source Serif 4 · A place for your words.</p>
          <p className="mono-type">Source Code Pro · account.example</p>
        </div>
      </section>
      <section aria-labelledby="spacing">
        <h2 id="spacing">Spacing</h2>
        <ul className="spacing-list">
          {tokens
            .filter((t) => t.category === "spacing")
            .map((t) => (
              <li key={t.name}>
                <code>{t.name}</code>
                <span
                  aria-hidden="true"
                  style={{ width: `var(${t.name.replaceAll(".", "\\.")})` }}
                />
                <span>{t.light}</span>
              </li>
            ))}
        </ul>
      </section>
      <section aria-labelledby="radius">
        <h2 id="radius">Radius</h2>
        <ul className="sample-grid">
          {tokens
            .filter((t) => t.category === "radius" && t.name !== "--radius")
            .map((t) => (
              <li
                className="foundation-card"
                key={t.name}
                style={{ borderRadius: `var(${t.name})` }}
              >
                <code>{t.name}</code>
                <p>{t.light}</p>
              </li>
            ))}
        </ul>
      </section>
      <section aria-labelledby="elevation">
        <h2 id="elevation">Elevation</h2>
        <ul className="sample-grid">
          {[0, 1, 2, 3].map((level) => (
            <li
              key={level}
              className="foundation-card"
              style={
                level === 0
                  ? { border: "var(--elevation-0-border)" }
                  : {
                      boxShadow: `var(--shadow-${level})`,
                      background: `var(--elevation-${level}-fill)`,
                    }
              }
            >
              <h3>Level {level}</h3>
              <p>{["At rest", "Raised card", "Popover", "Dialog"][level]}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="density">
        <h2 id="density">Density</h2>
        <div className="sample-grid">
          {(["comfortable", "compact"] as const).map((density) => (
            <div key={density} className="foundation-card" data-density={density}>
              <h3>{density === "comfortable" ? "Comfortable" : "Compact"}</h3>
              <ul className="density-rows">
                <li>
                  Project notes <span>Today</span>
                </li>
                <li>
                  Shared documents <span>Yesterday</span>
                </li>
              </ul>
              <label className="density-label" htmlFor={`density-${density}`}>
                Example control
              </label>
              <input id={`density-${density}`} readOnly value="Your document" />
              <p>Small control</p>
              <button type="button" className="small-control">
                Example
              </button>
              <div className="density-grid-card">Grid card</div>
            </div>
          ))}
        </div>
      </section>
      <section aria-labelledby="motion">
        <h2 id="motion">Motion</h2>
        <dl className="foundation-card motion-list">
          {tokens
            .filter((t) => t.category === "motion")
            .map((t) => (
              <div key={t.name}>
                <dt>
                  <code>{t.name}</code>
                </dt>
                <dd>{t.light}</dd>
              </div>
            ))}
        </dl>
      </section>
    </main>
  );
}
