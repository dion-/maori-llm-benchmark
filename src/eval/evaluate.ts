import { z } from "zod";
import type { TestCase } from "../core/runner";
import type { OpenRouterClient } from "../providers/openrouter";
import { normalizeText } from "./normalize";

export async function evaluateTest(
  test: TestCase,
  modelResponse: string,
  client: OpenRouterClient
): Promise<number> {
  const evalType = test.eval?.type;
  if (evalType === "exact") {
    return evaluateExact(test, modelResponse);
  }
  if (evalType === "llm-judge") {
    return evaluateLLMJudge(test, modelResponse, client);
  }
  return 0;
}

function evaluateExact(test: TestCase, modelResponse: string): number {
  const schema = z.object({
    normalize: z
      .object({
        macrons: z.boolean().optional(),
        case: z.enum(["insensitive", "sensitive"]).optional(),
        trim: z.boolean().optional(),
        stripOuterQuotes: z.boolean().optional(),
        punctuation: z.enum(["strip", "keep"]).optional(),
        whitespace: z.enum(["collapse", "keep"]).optional(),
      })
      .optional(),
    // If true, allow candidate to contain extra explanatory words as long as any expected appears as a standalone token sequence
    allowSubstring: z.boolean().optional(),
    // If true, accept if candidate starts with any expected (useful for answers followed by punctuation)
    allowPrefix: z.boolean().optional(),
  });
  const cfg = schema.safeParse(test.eval);
  const norm = cfg.success ? cfg.data.normalize ?? {} : {};
  const allowSubstring = cfg.success ? Boolean(cfg.data.allowSubstring) : false;
  const allowPrefix = cfg.success ? Boolean(cfg.data.allowPrefix) : false;
  const expected = Array.isArray(test.expected)
    ? (test.expected as unknown[]).map(String)
    : [String(test.expected ?? "")];

  const candidate = normalizeText(modelResponse, norm);
  for (const e of expected) {
    const ee = normalizeText(String(e), norm);
    if (ee === candidate) return 1;
    if (allowPrefix && candidate.startsWith(ee)) return 1;
    if (allowSubstring) {
      // Match on word boundaries to avoid partial-word matches
      const pattern = new RegExp(`(^|\\b)${escapeRegex(ee)}(\\b|$)`);
      if (pattern.test(candidate)) return 1;
    }
  }
  return 0;
}

async function evaluateLLMJudge(
  test: TestCase,
  modelResponse: string,
  client: OpenRouterClient
): Promise<number> {
  // Very light-weight judging: ask the model to rate 0..1.
  const prompt = `You are evaluating an answer for a Māori language test.
Provide a single number between 0 and 1 representing correctness.

Question prompt:
${test.prompt}

Model answer:
${modelResponse}

Expected (may be array):
${JSON.stringify(test.expected)}

Return only the number.`;
  const { text } = await client.complete({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a strict grader of Māori language answers. Ignore harmless formatting like quotes, trailing punctuation, or prefatory phrases (e.g., 'The answer is'). Grade semantic and orthographic correctness only. Output a single number between 0 and 1.",
      },
      { role: "user", content: prompt },
    ],
    params: { temperature: 0 },
  });
  const m = text.match(/[01](?:\.\d+)?/);
  const val = m ? Number(m[0]) : 0;
  if (Number.isNaN(val)) return 0;
  return Math.max(0, Math.min(1, val));
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
