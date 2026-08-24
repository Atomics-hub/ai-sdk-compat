import { clone, diagnostic, hasOwn, isRecord } from "./internal.js";
import type { Diagnostic, MigrationResult, UnknownRecord } from "./types.js";

function moveKey(
  output: UnknownRecord,
  from: string,
  to: string,
  diagnostics: Diagnostic[],
): void {
  if (!hasOwn(output, from)) return;
  if (!hasOwn(output, to)) {
    output[to] = output[from];
    diagnostics.push(
      diagnostic(`options.${from}`, `Renamed ${from} to ${to}.`, from),
    );
  } else
    diagnostics.push(
      diagnostic(
        `options.${from}-conflict`,
        `Kept ${to} because both ${from} and ${to} were present.`,
        from,
        "warning",
        true,
      ),
    );
  Reflect.deleteProperty(output, from);
}

/** Normalize renamed AI SDK call options while preserving runtime objects by identity. */
export function migrateCallOptions<TOutput extends object = UnknownRecord>(
  input: unknown,
): MigrationResult<TOutput> {
  if (!isRecord(input))
    return {
      value: clone(input) as TOutput,
      changed: false,
      diagnostics: [
        diagnostic(
          "options.invalid",
          "Expected an options object.",
          "",
          "error",
        ),
      ],
    };
  const output: UnknownRecord = clone(input);
  const diagnostics: Diagnostic[] = [];
  const migratableKeys = [
    "maxTokens",
    "system",
    "experimental_output",
    "experimental_telemetry",
    "experimental_include",
    "includeRawChunks",
  ];
  const changed = migratableKeys.some((key) => hasOwn(input, key));
  moveKey(output, "maxTokens", "maxOutputTokens", diagnostics);
  moveKey(output, "system", "instructions", diagnostics);
  moveKey(output, "experimental_output", "output", diagnostics);
  moveKey(output, "experimental_telemetry", "telemetry", diagnostics);
  moveKey(output, "experimental_include", "include", diagnostics);
  if (hasOwn(output, "includeRawChunks")) {
    const include = isRecord(output.include) ? clone(output.include) : {};
    if (!hasOwn(include, "rawChunks"))
      include.rawChunks = output.includeRawChunks;
    else
      diagnostics.push(
        diagnostic(
          "options.include-raw-conflict",
          "Kept include.rawChunks because includeRawChunks was also present.",
          "includeRawChunks",
          "warning",
          true,
        ),
      );
    output.include = include;
    delete output.includeRawChunks;
    diagnostics.push(
      diagnostic(
        "options.includeRawChunks",
        "Moved includeRawChunks to include.rawChunks.",
        "includeRawChunks",
      ),
    );
  }
  if (hasOwn(output, "maxSteps"))
    diagnostics.push(
      diagnostic(
        "options.maxSteps-manual",
        "maxSteps requires an AI SDK stopWhen helper and cannot be converted without coupling this package to an SDK major.",
        "maxSteps",
        "warning",
        true,
      ),
    );
  if (typeof output.prepareStep === "function")
    diagnostics.push(
      diagnostic(
        "options.prepareStep-runtime",
        "Audit prepareStep return values manually: system became instructions and v7 overrides carry forward.",
        "prepareStep",
        "warning",
        true,
      ),
    );
  return {
    value: output as TOutput,
    changed,
    diagnostics,
  };
}
