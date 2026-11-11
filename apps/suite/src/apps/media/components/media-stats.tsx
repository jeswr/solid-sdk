// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { type MediaRecord, mediaStats } from "@jeswr/solid-media-log";
import { EmptyState, Input, Label } from "@jeswr/suite-ui";
import { useId, useState } from "react";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Chart markup is intentionally isolated for the upcoming shared chart package. */
export function MediaStats({ records }: { records: MediaRecord[] }) {
  const id = useId();
  const [yearInput, setYearInput] = useState(String(new Date().getUTCFullYear()));
  const year = Number(yearInput);
  const validYear = /^\d{4}$/.test(yearInput) && year >= 1000 && year <= 9999;
  const stats = mediaStats(
    records.map((record) => record.data),
    year,
  );
  const maximum = Math.max(
    1,
    ...stats.months.map((month) => month.film + month.tv + month.book + month.game),
  );
  return (
    <section className="media-stats" aria-label="Year in review">
      <div className="media-year">
        <Label htmlFor={id}>Year</Label>
        <Input
          id={id}
          type="number"
          min={1000}
          max={9999}
          value={yearInput}
          aria-invalid={!validYear}
          onChange={(event) => setYearInput(event.target.value)}
        />
      </div>
      {!validYear ? (
        <p role="status">Enter a four-digit year to see your summary.</p>
      ) : (
        <>
          <div className="media-summary">
            <div>
              <strong>{stats.total}</strong>
              <span>items finished</span>
            </div>
            <div>
              <strong>{stats.average?.toFixed(1) ?? "—"}</strong>
              <span>average rating · {stats.rated} rated</span>
            </div>
            <div>
              <strong>
                {
                  stats.months.filter(
                    (month) => month.film + month.tv + month.book + month.game > 0,
                  ).length
                }
              </strong>
              <span>months of discoveries</span>
            </div>
          </div>
          {stats.best && (
            <p className="media-highlight">
              Your highest rated this year: <strong>{stats.best.title}</strong> ·{" "}
              {stats.best.rating} / 5
            </p>
          )}
          {!stats.total ? (
            <EmptyState
              title="A fresh page for your year"
              body="Mark items finished with a date to see your year take shape."
            />
          ) : (
            <>
              <h3>Finished each month</h3>
              <div className="media-chart" aria-hidden="true">
                {stats.months.map((month, index) => (
                  <div key={month.month}>
                    <div className="media-chart-track">
                      {(["film", "tv", "book", "game"] as const).map((kind) => (
                        <span
                          key={kind}
                          data-kind={kind}
                          style={{ height: `${(month[kind] / maximum) * 100}%` }}
                        />
                      ))}
                    </div>
                    <span>{months[index]}</span>
                  </div>
                ))}
              </div>
              <table className="media-stats-table">
                <caption>Monthly completions in {year}. TV includes individual episodes.</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Films</th>
                    <th scope="col">TV</th>
                    <th scope="col">Books</th>
                    <th scope="col">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.months.map((month, index) => (
                    <tr key={month.month}>
                      <th scope="row">{months[index]}</th>
                      <td>{month.film}</td>
                      <td>{month.tv}</td>
                      <td>{month.book}</td>
                      <td>{month.game}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="media-muted">
            Only dated completions count. Repeat counts and entries without a finish date aren't
            added to monthly totals.
          </p>
        </>
      )}
    </section>
  );
}
