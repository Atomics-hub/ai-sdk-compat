import { clone, diagnostic, hasOwn, isRecord } from "./internal.js";
import type { Diagnostic, MigrationResult, UnknownRecord } from "./types.js";

/** Normalize language-model token usage from AI SDK 4 through 7. */
export function migrateLanguageModelUsage<
  TOutput extends object = UnknownRecord,
>(input: unknown): MigrationResult<TOutput> {
  if (!isRecord(input))
    return {
      value: clone(input) as TOutput,
      changed: false,
      diagnostics: [
        diagnostic("usage.invalid", "Expected a usage object.", "", "error"),
      ],
    };
  const output: UnknownRecord = clone(input);
  const diagnostics: Diagnostic[] = [];
  let changed = false;

  const moveTokenKey = (from: string, to: string): void => {
    if (!hasOwn(output, from)) return;
    if (!hasOwn(output, to)) output[to] = output[from];
    else if (output[from] !== output[to])
      diagnostics.push(
        diagnostic(
          `usage.${from}-conflict`,
          `Kept ${to} because it conflicts with legacy ${from}.`,
          from,
          "warning",
          true,
        ),
      );
    Reflect.deleteProperty(output, from);
    changed = true;
    diagnostics.push(
      diagnostic(`usage.${from}`, `Renamed ${from} to ${to}.`, from),
    );
  };
  moveTokenKey("promptTokens", "inputTokens");
  moveTokenKey("completionTokens", "outputTokens");
  if (!hasOwn(output, "totalTokens")) {
    if (
      typeof output.inputTokens === "number" &&
      typeof output.outputTokens === "number"
    ) {
      output.totalTokens = output.inputTokens + output.outputTokens;
      diagnostics.push(
        diagnostic(
          "usage.total-calculated",
          "Calculated required totalTokens from inputTokens and outputTokens.",
          "totalTokens",
        ),
      );
      changed = true;
    } else {
      diagnostics.push(
        diagnostic(
          "usage.total-missing",
          "totalTokens is required but could not be calculated.",
          "totalTokens",
          "error",
          true,
        ),
      );
    }
  }
  for (const key of ["inputTokens", "outputTokens"])
    if (!hasOwn(output, key))
      diagnostics.push(
        diagnostic(
          `usage.${key}-missing`,
          `${key} is required but missing.`,
          key,
          "error",
          true,
        ),
      );
  const hasInputDetails = isRecord(output.inputTokenDetails);
  const hasOutputDetails = isRecord(output.outputTokenDetails);
  const inputDetails: UnknownRecord = hasInputDetails
    ? clone(output.inputTokenDetails as UnknownRecord)
    : {};
  const outputDetails: UnknownRecord = hasOutputDetails
    ? clone(output.outputTokenDetails as UnknownRecord)
    : {};
  if (!hasInputDetails || !hasOutputDetails) changed = true;
  if (hasOwn(output, "cachedInputTokens")) {
    if (!hasOwn(inputDetails, "cacheReadTokens"))
      inputDetails.cacheReadTokens = output.cachedInputTokens;
    else if (inputDetails.cacheReadTokens !== output.cachedInputTokens)
      diagnostics.push(
        diagnostic(
          "usage.cached-input-conflict",
          "Kept inputTokenDetails.cacheReadTokens because it conflicts with cachedInputTokens.",
          "cachedInputTokens",
          "warning",
          true,
        ),
      );
    delete output.cachedInputTokens;
    changed = true;
    diagnostics.push(
      diagnostic(
        "usage.cached-input",
        "Moved cachedInputTokens to inputTokenDetails.cacheReadTokens.",
        "cachedInputTokens",
      ),
    );
  }
  if (hasOwn(output, "reasoningTokens")) {
    if (!hasOwn(outputDetails, "reasoningTokens"))
      outputDetails.reasoningTokens = output.reasoningTokens;
    else if (outputDetails.reasoningTokens !== output.reasoningTokens)
      diagnostics.push(
        diagnostic(
          "usage.reasoning-conflict",
          "Kept outputTokenDetails.reasoningTokens because it conflicts with reasoningTokens.",
          "reasoningTokens",
          "warning",
          true,
        ),
      );
    delete output.reasoningTokens;
    changed = true;
    diagnostics.push(
      diagnostic(
        "usage.reasoning",
        "Moved reasoningTokens to outputTokenDetails.reasoningTokens.",
        "reasoningTokens",
      ),
    );
  }
  output.inputTokenDetails = inputDetails;
  output.outputTokenDetails = outputDetails;
  return { value: output as TOutput, changed, diagnostics };
}
