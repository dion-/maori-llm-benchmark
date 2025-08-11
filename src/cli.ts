#!/usr/bin/env bun
import { Command, Option } from "commander";
import chalk from "chalk";
import ora from "ora";
import { validateTestSuiteFile } from "./schema/test";
import { runBenchmark } from "./core/runner";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { printRunSummary } from "./reporting/summary";
import { SingleBar, Presets } from "cli-progress";

const program = new Command();

program.name("bench").description("Māori LLM Benchmark CLI").version("0.1.0");

program
  .command("validate")
  .description("Validate the JSON test suite at ./tests.json")
  .action(async () => {
    const spinner = ora("Validating test suite").start();
    try {
      const suitePath = resolve(process.cwd(), "tests.json");
      const { ok, errors, count } = await validateTestSuiteFile(suitePath);
      if (!ok) {
        spinner.fail(`Validation failed with ${errors.length} error(s):`);
        for (const err of errors) {
          console.error(` - ${chalk.red(err.path.join("."))}: ${err.message}`);
        }
        process.exitCode = 1;
        return;
      }
      spinner.succeed(`Validation passed (${count} tests).`);
    } catch (error) {
      spinner.fail("Validation error");
      console.error(error);
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .description(
    "Run the benchmark suite at ./tests.json against one or more models"
  )
  .addOption(
    new Option(
      "-m, --models <list>",
      "Comma-separated model names or provider ids"
    ).makeOptionMandatory(true)
  )
  .option(
    "-c, --concurrency <n>",
    "Max concurrent requests",
    (v) => Number(v),
    4
  )
  .option("--max-rpm <n>", "Max requests per minute", (v) => Number(v), 60)
  .option("--max-tpm <n>", "Max tokens per minute", (v) => Number(v), 120000)
  .option(
    "--model-config <path>",
    "Path to models.config.json (default: ./models.config.json)"
  )
  .option(
    "--out <dir>",
    "Output directory for results (default: ./results)",
    "results"
  )
  .option("--retries <n>", "Retries on 429/5xx", (v) => Number(v), 2)
  .option(
    "--timeout-ms <n>",
    "Per-request timeout (ms)",
    (v) => Number(v),
    30000
  )
  .action(async (opts) => {
    const spinner = ora("Starting benchmark run").start();
    try {
      const suitePath = resolve(process.cwd(), "tests.json");
      const suiteStr = readFileSync(suitePath, "utf8");
      const suiteJson = JSON.parse(suiteStr);

      // Validate before running
      const validation = await validateTestSuiteFile(suitePath);
      if (!validation.ok) {
        spinner.fail(
          "Suite validation failed. Use `bench validate` for details."
        );
        process.exitCode = 1;
        return;
      }

      const modelConfigPath = resolve(
        process.cwd(),
        opts.modelConfig ?? "models.config.json"
      );
      const modelsCsv: string = opts.models as string;
      const requestedModels = modelsCsv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let modelsConfig: unknown[] = [];
      if (existsSync(modelConfigPath)) {
        try {
          modelsConfig = JSON.parse(
            readFileSync(modelConfigPath, "utf8")
          ) as unknown[];
        } catch (err) {
          // ignore parse error; we'll proceed with direct ids
        }
      }

      spinner.text = "Resolving models";
      const resolvedModels = resolveModels(requestedModels, modelsConfig);
      if (resolvedModels.length === 0) {
        spinner.fail(
          "No models resolved. Provide --models or a valid models.config.json"
        );
        process.exitCode = 1;
        return;
      }

      const total = resolvedModels.length * suiteJson.length;
      spinner.stop();
      const bar = new SingleBar(
        {
          hideCursor: true,
          format: `${chalk.gray(
            "Progress"
          )} {bar} {percentage}% | {value}/{total}`,
        },
        Presets.shades_classic
      );
      bar.start(total, 0);

      const run = await runBenchmark({
        suite: suiteJson,
        suitePath,
        models: resolvedModels,
        concurrency: Number(opts.concurrency),
        maxRequestsPerMinute: Number(
          opts.maxRpm ??
            opts["max-rpm"] ??
            opts["maxRPM"] ??
            opts["maxRequestsPerMinute"] ??
            opts["max-requests-per-minute"] ??
            60
        ),
        maxTokensPerMinute: Number(opts.maxTpm ?? opts["max-tpm"] ?? 120000),
        retries: Number(opts.retries),
        timeoutMs: Number(opts.timeoutMs ?? opts["timeout-ms"] ?? 30000),
        outDir: resolve(process.cwd(), opts.out ?? "results"),
        onProgress: ({ completed }) => bar.update(completed),
      });
      bar.stop();
      ora().succeed(`Run complete: ${chalk.cyan(basename(run.runDir))}`);
      // Print a short summary to stdout
      printRunSummary(run);
    } catch (error) {
      try {
        ora().fail("Run failed");
      } catch {}
      console.error(error);
      process.exitCode = 1;
    }
  });

program
  .command("report")
  .description("Print a summary for a given run directory")
  .requiredOption(
    "-r, --run <dir>",
    "Path to the run directory (e.g., results/<run-id>)"
  )
  .action(async (opts: { run: string }) => {
    const runDir = resolve(process.cwd(), opts.run);
    const reportPath = resolve(runDir, "report.json");
    if (!existsSync(reportPath)) {
      console.error(chalk.red(`Report not found at ${reportPath}`));
      process.exitCode = 1;
      return;
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    printRunSummary(report);
  });

program.parseAsync();

type ModelConfig = {
  name: string;
  provider_id: string;
  reasoning_effort?: number;
  params?: Record<string, unknown>;
};

function resolveModels(
  requested: string[],
  modelsConfig: unknown[]
): { name: string; provider_id: string; params?: Record<string, unknown> }[] {
  const list: ModelConfig[] = Array.isArray(modelsConfig)
    ? (modelsConfig.filter(
        (m): m is ModelConfig =>
          !!m &&
          typeof m === "object" &&
          "provider_id" in m &&
          typeof (m as any).provider_id === "string"
      ) as ModelConfig[])
    : [];
  return requested.map((r) => {
    const hit = list.find((m) => m.name === r || m.provider_id === r);
    if (hit) {
      return {
        name: hit.name ?? hit.provider_id,
        provider_id: hit.provider_id,
        params: hit.params,
      };
    }
    return { name: r, provider_id: r };
  });
}
