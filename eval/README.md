# Eval gate (AgentProbe)

This directory holds the regression gate for the governed pipeline. It is an
[AgentProbe](https://github.com/cornhusk39/agentprobe) suite that CI runs in
**replay mode**: it does not call models or need an API key. It replays committed
cassettes (recorded pipeline behavior) and fails the build when a grounding,
citation, or refusal regression flips a deterministic assertion.

## What it checks

Four cases over the fixture corpus, covering the governance dimensions:

| Case | Dimension |
|------|-----------|
| `answered-grounded` | grounding accuracy + citation precision (verified, span-cited answer) |
| `refused-out-of-corpus` | refusal correctness (weak retrieval refused before generation) |
| `refused-fabricated-citation` | citation integrity (a citation to an unretrieved chunk is refused) |
| `refused-unverified` | verification (a claim the verifier cannot confirm is refused) |

Assertions are deterministic (`output-field`, `tool-call-order`, budgets), so the
gate is fully reproducible and needs no judge. There are no rubrics, so the judge
cache stays empty.

## Files

- `suite.json` — the cases and their assertions (generated)
- `cassettes/*.json` — recorded pipeline runs, one per case (generated)
- `baseline.json` — the green run snapshot the check diffs against (generated)
- `judge-cache.json` — empty; no rubrics (generated)
- `agentprobe.config.mjs` — replay-only config (no liveAgent / recordJudge)
- `build-eval.ts` — regenerates the suite and cassettes from the real pipeline

## Regenerating

Run the pipeline and rewrite the cassettes and suite, then re-baseline with a
local AgentProbe checkout:

```bash
pnpm exec tsx eval/build-eval.ts
# then, from your agentprobe checkout:
tsx packages/cli/src/index.ts baseline --config /abs/path/to/eval/agentprobe.config.mjs
```

Commit the regenerated `cassettes/`, `suite.json`, and `baseline.json` together.

## Proving the gate works

`build-eval.ts` accepts `INJECT_REGRESSION=1`, which makes the pipeline answer a
question it should refuse (the citation pre-check no longer trips). Regenerate the
cassettes with that flag and run `check`: the `refused-fabricated-citation` case
flips from pass to fail and the gate exits non-zero. Regenerate without the flag
and it passes again.
