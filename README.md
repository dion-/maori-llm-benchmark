# Māori LLM Benchmark (maori-benchmark)

CLI-first benchmarking for LLM competence in te reo Māori. Bun + TypeScript. JSON tests. OpenRouter for model access. Scores normalized to 0–100. Parallel execution with a configurable limiter.

## Why

- Measure Māori language proficiency across models (understanding + generation)
- Repeatable, transparent, fast; easy to extend via JSON tests

## Features (planned)

- Impressive CLI UX: progress bars, rich summaries, model leaderboards
- JSON test suites with schema validation
- Pluggable evaluators: exact/regex/distance/LLM-as-judge
- Concurrency limiter + rate/Token budgets (RPM/TPM)
- Deterministic scoring to 0–100 with weighted components
- Artifacts: prompts/responses, reports, run metadata

## Design influences (prior art)

- LLMeBench for flexible task coverage and provider adapters: [arXiv 2308.04945](https://arxiv.org/abs/2308.04945?utm_source=openai)
- HELM-style multi-metric thinking: [overview](https://www.linkedin.com/pulse/llm-evaluation-metrics-frameworks-best-practices-dr-rabi-prasad-padhy-g66yc?utm_source=openai)
- GLUE/SuperGLUE suite perspective (task diversity): [summary](https://www.restack.io/p/ai-benchmarking-answer-best-benchmarks-cat-ai?utm_source=openai)
- Modular inference benchmarking ideas: [Flexible Inference Bench](https://github.com/CentML/flexible-inference-bench?utm_source=openai)
- Māori proficiency framing (aural/vocabulary/grammar): [Te Taura Whiri LFE](https://en.tetaurawhiri.govt.nz/lfe?utm_source=openai)
- Benchmarking fundamentals/cautions: [NVIDIA](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts?utm_source=openai), [pitfalls](https://www.openxcell.com/blog/llm-benchmarks/?utm_source=openai)

## What we will benchmark (initial)

- Translation EN↔MI (literal vs idiomatic)
- Grammar + morphosyntax (particles, TAM, word order)
- Orthography (macrons, casing, punctuation)
- Vocabulary + idioms (kupu hou, collocations)
- Cultural appropriateness/register (tikanga, names)
- Named entities/transliteration (iwi/hapū/marae, toponyms)

## Scoring (0–100)

- Per-test raw score in [0,1]; suite aggregates to percentage
- Default weights (configurable):
  - Translation 30%
  - Grammar/orthography 25%
  - Vocabulary/idioms 20%
  - Cultural/register 15%
  - Names/macrons 10%

## JSON test format

Each test is an object; suites are arrays. Evaluator determines scoring.

```json
{
  "id": "vocab_kupu_001",
  "task": "vocabulary",
  "prompt": "Translate the English word 'family' into te reo Māori. Answer with a single word.",
  "expected": ["whānau"],
  "eval": {
    "type": "exact",
    "normalize": { "macrons": true, "case": "insensitive", "trim": true }
  },
  "metadata": { "domain": "everyday", "level": "A1" }
}
```

Supported `eval.type` (initial): `exact`, `llm-judge`.

## CLI (planned)

- `bench run` — run a suite against models
- `bench validate` — validate test JSON
- `bench report` — summarize/compare runs

Example usage (subject to change):

```bash
bun install
bun run bench \
  --models gpt-4o-tuned,claude-3.5-sonnet-fast \
  --concurrency 4 \
  --max-rpm 60 --max-tpm 120000
```

## OpenRouter integration

- Base: `https://openrouter.ai/api/v1`
- Auth: `OPENROUTER_API_KEY`; optional `HTTP-Referer`, `X-Title`
- Reference: [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)
- Use OpenAI JS library

## Concurrency, budgets, retries

- Limiter: `--concurrency N`
- Budgets: `--max-rpm`, `--max-tpm`; exponential backoff on 429/5xx
- Queue shaping: jitter; optional circuit-breaker per provider/model

## Outputs/artifacts

- `results/<run-id>/report.json` — per-test/model scores + timings
- `results/<run-id>/summary.md` — human summary
- `results/<run-id>/traces/` — prompts/responses/judge rationales
- `leaderboard.json` — rolling comparison across runs

## Reproducibility

- Persist model IDs/provider strings from OpenRouter
- Fix gen params (temperature, top_p, seed where supported)
- Store full prompts, few-shot examples, evaluator config

## Proposed structure

```
src/
  cli.ts
  core/runner.ts
  core/rateLimiter.ts
  providers/openrouter.ts
  eval/strategies/*.ts
  scoring/aggregator.ts
  schema/test.ts
  reporting/{summary,leaderboard}.ts

tests/
results/
```

## Configuration

- Env: `OPENROUTER_API_KEY`, optional `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE`
- CLI flags override config file values
- JSON Schema validation for tests

### Model Configuration (`models.config.json`)

Models are defined in a separate configuration file (default: `models.config.json`) to create aliases, pre-configure provider-specific parameters, and attach custom metadata like `reasoning_effort`.

```json
[
  {
    "name": "gpt-4o-tuned",
    "provider_id": "openai/gpt-4o",
    "reasoning_effort": 0.9,
    "params": {
      "temperature": 0.5
    }
  },
  {
    "name": "claude-3.5-sonnet-fast",
    "provider_id": "anthropic/claude-3.5-sonnet",
    "reasoning_effort": 0.5
  }
]
```

## References

- OpenRouter Quickstart: https://openrouter.ai/docs/quickstart
- LLMeBench: https://arxiv.org/abs/2308.04945?utm_source=openai
- HELM overview: https://www.linkedin.com/pulse/llm-evaluation-metrics-frameworks-best-practices-dr-rabi-prasad-padhy-g66yc?utm_source=openai
- GLUE/SuperGLUE summary: https://www.restack.io/p/ai-benchmarking-answer-best-benchmarks-cat-ai?utm_source=openai
- Flexible Inference Bench: https://github.com/CentML/flexible-inference-bench?utm_source=openai
- LFE: https://en.tetaurawhiri.govt.nz/lfe?utm_source=openai
- Benchmarking fundamentals: https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts?utm_source=openai
- Pitfalls: https://www.openxcell.com/blog/llm-benchmarks/?utm_source=openai
