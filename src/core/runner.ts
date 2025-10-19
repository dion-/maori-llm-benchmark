import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createOpenRouterClient,
  type OpenRouterClient,
} from "../providers/openrouter";
import { evaluateTest } from "../eval/evaluate";
import { createLimiter } from "./throttle";
import { randomUUID } from "node:crypto";
import { renderRunSummaryMarkdown } from "../reporting/summary";

export type TestCase = {
  id: string;
  task: string;
  prompt: string;
  expected?: unknown;
  eval: { type: "exact" | "llm-judge"; [k: string]: unknown };
  metadata?: Record<string, unknown>;
};

export type RunOptions = {
  suite: TestCase[];
  suitePath: string;
  models: {
    name: string;
    provider_id: string;
    params?: Record<string, unknown>;
  }[];
  concurrency: number;
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  retries: number;
  timeoutMs: number;
  outDir: string;
  onProgress?: (p: {
    completed: number;
    total: number;
    last?: TestResult;
  }) => void;
};

export type TestResult = {
  testId: string;
  model: string;
  provider_id: string;
  prompt: string;
  response: string;
  raw?: unknown;
  score: number; // 0..1 per-test
  latencyMs: number;
  expected?: unknown;
  error?: string;
};

export type RunOutput = {
  runId: string;
  runDir: string;
  startedAt: string;
  finishedAt: string;
  suitePath: string;
  models: RunOptions["models"];
  results: TestResult[];
  summary: {
    byModel: Record<string, { tests: number; avgScore: number }>;
    overallAvg: number;
  };
};

export async function runBenchmark(options: RunOptions): Promise<RunOutput> {
  const runId =
    new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14) +
    "-" +
    randomUUID().slice(0, 8);
  const runDir = resolve(options.outDir, runId);
  if (!existsSync(runDir)) {
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(runDir, "traces"), { recursive: true });
  }

  const limiter = createLimiter({
    maxConcurrent: options.concurrency,
    maxRequestsPerMinute: options.maxRequestsPerMinute,
    maxTokensPerMinute: options.maxTokensPerMinute,
  });

  const client: OpenRouterClient = createOpenRouterClient({
    timeoutMs: options.timeoutMs,
  });

  const results: TestResult[] = [];
  const startedAt = new Date().toISOString();
  const total = options.models.length * options.suite.length;
  let completed = 0;

  const tasks: Promise<TestResult>[] = [];
  for (const model of options.models) {
    for (const test of options.suite) {
      const estimatedTokens = estimateTokens(test.prompt);
      const task = limiter
        .schedule(async () => {
          const t0 = performance.now();
          try {
            const { text, raw } = await withRetry(
              async () =>
                client.complete({
                  model: model.provider_id,
                  messages: [
                    {
                      role: "system",
                      content:
                        test.eval?.type === "exact"
                          ? "You are a helpful assistant. Respond ONLY with the answer, and nothing else. Do not add any preamble, context, or commentary."
                          : "You are a helpful assistant. Respond concisely.",
                    },
                    { role: "user", content: test.prompt },
                  ],
                  params: model.params ?? {},
                }),
              options.retries
            );
            const latencyMs = Math.round(performance.now() - t0);
            const score = await evaluateTest(test, text, client);
            const result: TestResult = {
              testId: test.id,
              model: model.name,
              provider_id: model.provider_id,
              prompt: test.prompt,
              response: text,
              raw,
              score,
              latencyMs,
              expected: test.expected,
            };
            writeTrace(runDir, result);
            return result;
          } catch (err) {
            const latencyMs = Math.round(performance.now() - t0);
            const result: TestResult = {
              testId: test.id,
              model: model.name,
              provider_id: model.provider_id,
              prompt: test.prompt,
              response: "",
              score: 0,
              latencyMs,
              expected: test.expected,
              error: err instanceof Error ? err.message : String(err),
            };
            writeTrace(runDir, result);
            return result;
          }
        }, estimatedTokens)
        .then((res) => {
          results.push(res);
          completed += 1;
          options.onProgress?.({ completed, total, last: res });
          return res;
        });
      tasks.push(task);
    }
  }
  await Promise.all(tasks);

  const finishedAt = new Date().toISOString();
  const summary = summarize(results);
  const output: RunOutput = {
    runId,
    runDir,
    startedAt,
    finishedAt,
    suitePath: options.suitePath,
    models: options.models,
    results,
    summary,
  };
  writeFileSync(
    join(runDir, "report.json"),
    JSON.stringify(output, null, 2),
    "utf8"
  );
  // Also write a human-readable summary
  const md = renderRunSummaryMarkdown(output);
  writeFileSync(join(runDir, "summary.md"), md, "utf8");
  return output;
}

function writeTrace(runDir: string, r: TestResult): void {
  const isFail = Boolean(r.error) || r.score < 1;
  const status = isFail ? "__FAIL" : "";
  const name = `${sanitize(r.model)}__${sanitize(r.testId)}${status}.json`;
  const path = join(runDir, "traces", name);
  writeFileSync(
    path,
    JSON.stringify(
      {
        testId: r.testId,
        model: r.model,
        provider_id: r.provider_id,
        prompt: r.prompt,
        response: r.response,
        score: r.score,
        latencyMs: r.latencyMs,
        expected: r.expected,
        error: r.error,
        raw: r.raw,
      },
      null,
      2
    ),
    "utf8"
  );
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function summarize(results: TestResult[]): RunOutput["summary"] {
  const byModel: Record<string, { tests: number; sum: number }> = {};
  for (const r of results) {
    const key = r.model;
    if (!byModel[key]) byModel[key] = { tests: 0, sum: 0 };
    byModel[key].tests += 1;
    byModel[key].sum += r.score;
  }
  const summary: RunOutput["summary"] = {
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([k, v]) => [
        k,
        { tests: v.tests, avgScore: v.tests ? v.sum / v.tests : 0 },
      ])
    ),
    overallAvg: results.length
      ? results.reduce((acc, r) => acc + r.score, 0) / results.length
      : 0,
  };
  return summary;
}

function estimateTokens(text: string): number {
  // Very rough heuristic: 1 token ~ 4 chars
  const length = (text ?? "").length;
  return Math.max(50, Math.ceil(length / 4) + 50);
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let attempt = 0;
  let delay = 500;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const status = (err as any)?.status ?? (err as any)?.response?.status;
      const retriable =
        status === 429 || (typeof status === "number" && status >= 500);
      if (!retriable || attempt > retries) throw err;
      const jitter = Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(8000, Math.round(delay * 2));
    }
  }
}
