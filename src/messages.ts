import { clone, diagnostic, hasOwn, isRecord, pathJoin } from "./internal.js";
import type {
  Diagnostic,
  MessageMigrationOptions,
  MigrationResult,
  UnknownRecord,
} from "./types.js";

const TOOL_STATES: Readonly<Record<string, string>> = {
  "partial-call": "input-streaming",
  call: "input-available",
  result: "output-available",
};
const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

/** Detect whether a value contains a known AI SDK 4 UI-message persistence shape. */
export function isLegacyUIMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    value.role === "data" ||
    hasOwn(value, "content") ||
    hasOwn(value, "toolInvocations") ||
    hasOwn(value, "reasoning")
  )
    return true;
  return (
    Array.isArray(value.parts) &&
    value.parts.some(
      (part) =>
        isRecord(part) &&
        (part.type === "tool-invocation" ||
          hasOwn(part, "args") ||
          hasOwn(part, "result") ||
          (part.type === "reasoning" && hasOwn(part, "reasoning"))),
    )
  );
}

function migrateTool(
  invocation: UnknownRecord,
  path: string,
  diagnostics: Diagnostic[],
): UnknownRecord {
  const name =
    typeof invocation.toolName === "string" && invocation.toolName.length > 0
      ? invocation.toolName
      : "unknown";
  if (name === "unknown")
    diagnostics.push(
      diagnostic(
        "message.tool-name-missing",
        "A legacy tool invocation had no toolName; the generated part uses tool-unknown.",
        path,
        "warning",
        true,
      ),
    );
  const knownState =
    typeof invocation.state === "string"
      ? TOOL_STATES[invocation.state]
      : undefined;
  const state =
    knownState ??
    (hasOwn(invocation, "result")
      ? "output-available"
      : hasOwn(invocation, "args")
        ? "input-available"
        : "input-streaming");
  if (!knownState)
    diagnostics.push(
      diagnostic(
        "message.tool-state-unknown",
        `Missing or unknown legacy tool state ${JSON.stringify(invocation.state)} inferred as ${state}.`,
        pathJoin(path, "state"),
        "warning",
        true,
      ),
    );
  const migrated: UnknownRecord = clone(invocation);
  delete migrated.toolName;
  delete migrated.args;
  delete migrated.result;
  migrated.type = `tool-${name}`;
  migrated.toolCallId = invocation.toolCallId;
  migrated.input = clone(invocation.args);
  migrated.state = state;
  if (invocation.state === "result" || hasOwn(invocation, "result"))
    migrated.output = clone(invocation.result);
  if (hasOwn(invocation, "providerExecuted"))
    migrated.providerExecuted = invocation.providerExecuted;
  if (
    typeof invocation.toolCallId !== "string" ||
    invocation.toolCallId.length === 0
  )
    diagnostics.push(
      diagnostic(
        "message.tool-call-id-missing",
        "The legacy tool invocation has no usable toolCallId.",
        pathJoin(path, "toolCallId"),
        "error",
        true,
      ),
    );
  diagnostics.push(
    diagnostic(
      "message.tool-invocation",
      `Converted legacy tool invocation to tool-${name}.`,
      path,
    ),
  );
  return migrated;
}

function migratePart(
  part: unknown,
  path: string,
  diagnostics: Diagnostic[],
): unknown {
  if (!isRecord(part)) return clone(part);
  if (part.type === "tool-invocation" && isRecord(part.toolInvocation)) {
    return migrateTool(
      part.toolInvocation,
      pathJoin(path, "toolInvocation"),
      diagnostics,
    );
  }
  if (part.type === "reasoning" && typeof part.reasoning === "string") {
    const result = clone(part);
    result.text = part.reasoning;
    delete result.reasoning;
    if (Array.isArray(result.details) && result.details.length > 0)
      diagnostics.push(
        diagnostic(
          "message.reasoning-details-dropped",
          "Legacy reasoning details have no direct UI-message equivalent and were removed.",
          pathJoin(path, "details"),
          "warning",
          true,
        ),
      );
    delete result.details;
    diagnostics.push(
      diagnostic(
        "message.reasoning-part",
        "Renamed reasoning part content to text.",
        path,
      ),
    );
    return result;
  }
  if (part.type === "source" && isRecord(part.source)) {
    const result = clone(part);
    const extraSourceKeys = Object.keys(part.source).filter(
      (key) => !["id", "url", "title", "sourceType"].includes(key),
    );
    if (extraSourceKeys.length > 0)
      diagnostics.push(
        diagnostic(
          "message.source-fields-dropped",
          `Legacy source fields have no canonical equivalent: ${extraSourceKeys.join(", ")}.`,
          pathJoin(path, "source"),
          "warning",
          true,
        ),
      );
    diagnostics.push(
      diagnostic(
        "message.source-part",
        "Converted legacy source part to source-url.",
        path,
      ),
    );
    result.type = "source-url";
    result.sourceId = part.source.id;
    result.url = part.source.url;
    if (part.source.title !== undefined) result.title = part.source.title;
    delete result.source;
    return result;
  }
  if (
    part.type === "file" &&
    typeof part.mimeType === "string" &&
    hasOwn(part, "data") &&
    !hasOwn(part, "mediaType")
  ) {
    diagnostics.push(
      diagnostic(
        "message.file-part",
        "Converted legacy UI file fields to mediaType and url.",
        path,
      ),
    );
    const result = clone(part);
    result.mediaType = part.mimeType;
    result.url = clone(part.data);
    delete result.mimeType;
    delete result.data;
    return result;
  }
  return clone(part);
}

function topLevelParts(
  message: UnknownRecord,
  diagnostics: Diagnostic[],
): unknown[] {
  const parts: unknown[] = [];
  if (typeof message.reasoning === "string" && message.reasoning.length > 0) {
    parts.push({ type: "reasoning", text: message.reasoning });
    diagnostics.push(
      diagnostic(
        "message.reasoning-field",
        "Moved top-level reasoning into a reasoning part.",
        "reasoning",
      ),
    );
  }
  if (Array.isArray(message.toolInvocations))
    message.toolInvocations.forEach((invocation, index) => {
      if (isRecord(invocation))
        parts.push(
          migrateTool(
            invocation,
            pathJoin("toolInvocations", index),
            diagnostics,
          ),
        );
    });
  if (typeof message.content === "string" && message.content.length > 0) {
    parts.push({ type: "text", text: message.content });
    diagnostics.push(
      diagnostic(
        "message.content-field",
        "Moved top-level content into a text part.",
        "content",
      ),
    );
  }
  return parts;
}

function validateMessageShape(
  message: UnknownRecord,
  diagnostics: Diagnostic[],
): void {
  if (typeof message.id !== "string" || message.id.length === 0)
    diagnostics.push(
      diagnostic(
        "message.id-invalid",
        "Message id must be a non-empty string.",
        "id",
        "error",
      ),
    );
  if (typeof message.role !== "string" || !MESSAGE_ROLES.has(message.role))
    diagnostics.push(
      diagnostic(
        "message.role-invalid",
        "Message role must be system, user, or assistant.",
        "role",
        "error",
      ),
    );
  if (!Array.isArray(message.parts)) {
    diagnostics.push(
      diagnostic(
        "message.parts-invalid",
        "Message parts must be an array.",
        "parts",
        "error",
      ),
    );
    return;
  }
  message.parts.forEach((part, index) => {
    if (!isRecord(part) || typeof part.type !== "string")
      diagnostics.push(
        diagnostic(
          "message.part-invalid",
          "Each message part must be an object with a string type.",
          pathJoin("parts", index),
          "error",
        ),
      );
  });
}

/** Migrate or audit one UI message without mutating the input. */
export function migrateUIMessage<TOutput extends object = UnknownRecord>(
  input: unknown,
  index = 0,
  options: MessageMigrationOptions = {},
): MigrationResult<TOutput> {
  if (!isRecord(input))
    return {
      value: clone(input) as TOutput,
      changed: false,
      diagnostics: [
        diagnostic(
          "message.invalid",
          "Expected a message object.",
          "",
          "error",
        ),
      ],
    };
  if (!isLegacyUIMessage(input)) {
    const output: UnknownRecord = clone(input);
    const diagnostics: Diagnostic[] = [];
    let changed = false;
    if (typeof output.id !== "string" || output.id.length === 0) {
      output.id = options.idFactory?.(input, index) ?? `msg-${String(index)}`;
      diagnostics.push(
        diagnostic(
          "message.id-generated",
          "Generated a missing message id.",
          "id",
        ),
      );
      changed = true;
    }
    validateMessageShape(output, diagnostics);
    return { value: output as TOutput, changed, diagnostics };
  }

  const diagnostics: Diagnostic[] = [];
  const output: UnknownRecord = clone(input);
  output.id =
    typeof input.id === "string" && input.id.length > 0
      ? input.id
      : (options.idFactory?.(input, index) ?? `msg-${String(index)}`);
  if (output.id !== input.id)
    diagnostics.push(
      diagnostic(
        "message.id-generated",
        "Generated a missing message id.",
        "id",
      ),
    );

  if (input.role === "data") {
    output.role = "assistant";
    output.parts = [
      { type: "data-custom", data: clone(input.data ?? input.content) },
    ];
    diagnostics.push(
      diagnostic(
        "message.data-role",
        "Converted the removed data role to an assistant data-custom part.",
        "role",
        "warning",
      ),
    );
  } else {
    if (
      Array.isArray(input.parts) &&
      (hasOwn(input, "content") ||
        hasOwn(input, "reasoning") ||
        hasOwn(input, "toolInvocations"))
    )
      diagnostics.push(
        diagnostic(
          "message.parts-authoritative",
          "The parts array was treated as authoritative; duplicate top-level content, reasoning, or toolInvocations were removed.",
          "parts",
          "warning",
          true,
        ),
      );
    output.parts = Array.isArray(input.parts)
      ? input.parts.map((part, partIndex) =>
          migratePart(part, pathJoin("parts", partIndex), diagnostics),
        )
      : topLevelParts(input, diagnostics);
  }
  if (!options.preserveLegacyFields) {
    delete output.content;
    delete output.reasoning;
    delete output.toolInvocations;
    if (input.role === "data") delete output.data;
  }
  validateMessageShape(output, diagnostics);
  return { value: output as TOutput, changed: true, diagnostics };
}

/** Migrate an array of UI messages and prefix diagnostics with array paths. */
export function migrateUIMessages<TOutput extends object = UnknownRecord>(
  messages: readonly unknown[],
  options: MessageMigrationOptions = {},
): MigrationResult<TOutput[]> {
  const value: TOutput[] = [];
  const diagnostics: Diagnostic[] = [];
  let changed = false;
  messages.forEach((message, index) => {
    const result = migrateUIMessage<TOutput>(message, index, options);
    value.push(result.value);
    changed ||= result.changed;
    diagnostics.push(
      ...result.diagnostics.map((entry) => ({
        ...entry,
        path: `messages[${String(index)}]${entry.path ? `.${entry.path}` : ""}`,
      })),
    );
  });
  return { value, changed, diagnostics };
}
