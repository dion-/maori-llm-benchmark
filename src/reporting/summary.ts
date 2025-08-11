import chalk from "chalk";
import type { RunOutput } from "../core/runner";

export function printRunSummary(run: RunOutput): void {
  const id = run.runDir.split("/").pop() ?? run.runId;
  console.log(chalk.bold(`\nRun ${id}`));
  console.log(
    `Models: ${run.models.map((m) => chalk.cyan(m.name)).join(", ")}`
  );
  console.log(`Tests: ${run.results.length}`);
  console.log(`Overall avg: ${formatPct(run.summary.overallAvg)}`);
  console.log("By model:");
  for (const [model, s] of Object.entries(run.summary.byModel)) {
    console.log(
      `  - ${chalk.cyan(model)}: ${formatPct(s.avgScore)} (${s.tests} tests)`
    );
  }
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function renderRunSummaryMarkdown(run: RunOutput): string {
  const id = run.runDir.split("/").pop() ?? run.runId;
  const lines: string[] = [];
  lines.push(`# Run ${id}`);
  lines.push("");
  lines.push(`- Models: ${run.models.map((m) => m.name).join(", ")}`);
  lines.push(`- Tests: ${run.results.length}`);
  lines.push(`- Overall Avg: ${formatPct(run.summary.overallAvg)}`);
  lines.push("");
  lines.push("## By Model");
  for (const [model, s] of Object.entries(run.summary.byModel)) {
    lines.push(`- ${model}: ${formatPct(s.avgScore)} (${s.tests} tests)`);
  }
  return lines.join("\n");
}
