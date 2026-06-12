// Token pricing for cost accounting in the audit log.
//
// These are USD per million tokens. They are intentionally simple and explicit:
// the audit log records an estimated cost per query, and that estimate is only as
// honest as this table. Update it when prices change. Unknown models fall back to
// zero cost rather than guessing, so a wrong number never silently inflates an
// audit record.

export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

const RATES: Record<string, ModelRate> = {
  "claude-opus-4-8": { inputPerMillion: 5, outputPerMillion: 25 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = RATES[model];
  if (!rate) {
    return 0;
  }
  return (
    (inputTokens / 1_000_000) * rate.inputPerMillion +
    (outputTokens / 1_000_000) * rate.outputPerMillion
  );
}
