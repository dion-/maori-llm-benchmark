import { z } from "zod";
import { readFileSync } from "node:fs";

export const TestSchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  prompt: z.string().min(1),
  expected: z.any().optional(),
  eval: z.object({ type: z.enum(["exact", "llm-judge"]) }).passthrough(),
  metadata: z.record(z.any()).optional(),
});

export const TestSuiteSchema = z.array(TestSchema).min(1);

export async function validateTestSuiteFile(
  filePath: string
): Promise<{
  ok: boolean;
  count: number;
  errors: { path: (string | number)[]; message: string }[];
}> {
  const json = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const res = TestSuiteSchema.safeParse(json);
  if (res.success) {
    return { ok: true, count: res.data.length, errors: [] };
  }
  const zerrs = res.error.issues.map((i) => ({
    path: i.path,
    message: i.message,
  }));
  return { ok: false, count: 0, errors: zerrs };
}
