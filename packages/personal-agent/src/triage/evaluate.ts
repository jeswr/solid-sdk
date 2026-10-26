/**
 * Evaluation over a labelled corpus: accuracy on answered items, abstention ("uncertain") rate,
 * a confusion matrix and the individual errors for error analysis. It measures whatever
 * classifier function it is given — running it on the local baseline says nothing about any
 * hosted model.
 */
import type { LabelledSample } from "./corpus.js";
import type { TriageSuggestion } from "./taxonomy.js";

export interface EvaluationReport {
  items: number;
  answered: number;
  abstained: number;
  correctAnswered: number;
  /** Accuracy of the best guess (candidate when uncertain) — for error analysis only. */
  candidateAccuracy: number;
  confusion: Record<string, Record<string, number>>;
  errors: { id: string; expected: string; got: string; candidate?: string }[];
}

export async function evaluate(
  corpus: readonly LabelledSample[],
  classify: (item: LabelledSample) => Promise<TriageSuggestion>,
): Promise<EvaluationReport> {
  const report: EvaluationReport = {
    items: corpus.length,
    answered: 0,
    abstained: 0,
    correctAnswered: 0,
    candidateAccuracy: 0,
    confusion: {},
    errors: [],
  };
  let candidateCorrect = 0;
  for (const item of corpus) {
    const r = await classify(item);
    const guess = r.primary === "uncertain" ? r.primaryCandidate : r.primary;
    if (guess === item.primary) candidateCorrect++;
    report.confusion[item.primary] ??= {};
    const row = report.confusion[item.primary] as Record<string, number>;
    row[r.primary] = (row[r.primary] ?? 0) + 1;
    if (r.primary === "uncertain") report.abstained++;
    else {
      report.answered++;
      if (r.primary === item.primary) report.correctAnswered++;
    }
    if (guess !== item.primary)
      report.errors.push({
        id: item.id,
        expected: item.primary,
        got: r.primary,
        ...(r.primaryCandidate ? { candidate: r.primaryCandidate } : {}),
      });
  }
  report.candidateAccuracy = corpus.length ? candidateCorrect / corpus.length : 0;
  return report;
}
