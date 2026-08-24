#!/usr/bin/env node
import {
  chmod,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { migrateModelContentPart } from "./content.js";
import { migrateUIMessage, migrateUIMessages } from "./messages.js";
import { migrateCallOptions } from "./options.js";
import type { MigrationResult } from "./types.js";
import { migrateLanguageModelUsage } from "./usage.js";

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const HELP = `ai-sdk-compat <check|migrate> <messages|options|usage|content> <file> [options]

Audits or migrates JSON without loading the AI SDK at runtime.

Options:
  --write          Atomically replace the input file
  --force          Allow --write when errors or lossy diagnostics exist
  --max-bytes N    Maximum input size (default: ${String(DEFAULT_MAX_BYTES)})

Examples:
  ai-sdk-compat check messages messages.json
  ai-sdk-compat migrate messages messages.json
  ai-sdk-compat migrate messages messages.json --write
`;

function parseFlags(flags: readonly string[]): {
  force: boolean;
  maxBytes: number;
  write: boolean;
} {
  let maxBytes = DEFAULT_MAX_BYTES;
  const values = new Set<string>();
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--write" || flag === "--force") {
      values.add(flag);
      continue;
    }
    if (flag === "--max-bytes") {
      const raw = flags[index + 1];
      const parsed = Number(raw);
      if (!raw || !Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error("--max-bytes requires a positive safe integer.");
      maxBytes = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option ${JSON.stringify(flag)}.`);
  }
  return {
    force: values.has("--force"),
    maxBytes,
    write: values.has("--write"),
  };
}

function transform(kind: string, value: unknown): MigrationResult<unknown> {
  if (kind === "messages") {
    if (Array.isArray(value)) return migrateUIMessages(value);
    return migrateUIMessage(value);
  }
  if (kind === "options") return migrateCallOptions(value);
  if (kind === "usage") return migrateLanguageModelUsage(value);
  if (kind === "content") return migrateModelContentPart(value);
  throw new Error(`Unknown kind ${JSON.stringify(kind)}.`);
}

async function atomicWrite(filename: string, content: string): Promise<void> {
  const mode = (await stat(filename)).mode;
  const temporary = join(
    dirname(filename),
    `.${basename(filename)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode });
    await chmod(temporary, mode);
    await rename(temporary, filename);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const [command, kind, filename, ...flags] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (!["check", "migrate"].includes(command ?? "") || !kind || !filename) {
    process.stderr.write(HELP);
    process.exitCode = 2;
    return;
  }
  const { force, maxBytes, write } = parseFlags(flags);
  if (command === "check" && (force || write))
    throw new Error("--write and --force are only valid with migrate.");
  const file = await stat(filename);
  if (file.size > maxBytes)
    throw new Error(
      `Input is ${String(file.size)} bytes, exceeding --max-bytes ${String(maxBytes)}.`,
    );
  const source = await readFile(filename, "utf8");
  const parsed: unknown = JSON.parse(source);
  const result = transform(kind, parsed);
  for (const entry of result.diagnostics) {
    process.stderr.write(
      `${entry.severity.toUpperCase()} ${entry.code} ${entry.path || "<root>"}: ${entry.message}\n`,
    );
  }
  if (command === "check") {
    const review = result.diagnostics.some(
      (entry) => entry.severity === "error" || entry.lossy,
    );
    process.stdout.write(
      result.changed
        ? "migration required\n"
        : review
          ? "manual review required\n"
          : "compatible\n",
    );
    if (result.changed || review) process.exitCode = 1;
    return;
  }
  const unsafe = result.diagnostics.some(
    (entry) => entry.severity === "error" || entry.lossy,
  );
  if (write && unsafe && !force) {
    process.stderr.write(
      "Refusing --write because errors or lossy diagnostics exist; review them or rerun with --force.\n",
    );
    process.exitCode = 1;
    return;
  }
  const output = `${JSON.stringify(result.value, null, 2)}\n`;
  if (write) await atomicWrite(filename, output);
  else process.stdout.write(output);
  if (result.diagnostics.some((entry) => entry.severity === "error"))
    process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
