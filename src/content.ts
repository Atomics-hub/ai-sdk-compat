import { clone, diagnostic, hasOwn, isRecord } from "./internal.js";
import type {
  ContentMigrationOptions,
  Diagnostic,
  MigrationResult,
  UnknownRecord,
} from "./types.js";

/** Convert deprecated model and tool-output file variants to canonical file parts. */
export function migrateModelContentPart<TOutput extends object = UnknownRecord>(
  input: unknown,
  options: ContentMigrationOptions = {},
): MigrationResult<TOutput> {
  if (!isRecord(input))
    return {
      value: clone(input) as TOutput,
      changed: false,
      diagnostics: [
        diagnostic(
          "content.invalid",
          "Expected a content part object.",
          "",
          "error",
        ),
      ],
    };

  const part: UnknownRecord = clone(input);
  const diagnostics: Diagnostic[] = [];
  if (part.type === "image" && hasOwn(part, "image")) {
    part.type = "file";
    part.mediaType ??= "image";
    part.data = part.image;
    delete part.image;
    diagnostics.push(
      diagnostic(
        "content.image-part",
        "Converted deprecated image content part to file.",
        "type",
      ),
    );
    return { value: part as TOutput, changed: true, diagnostics };
  }

  if (part.type === "file-id" || part.type === "image-file-id") {
    if (!options.provider && !isRecord(part.fileId))
      return {
        value: part as TOutput,
        changed: false,
        diagnostics: [
          diagnostic(
            "content.provider-required",
            "Converting a *-id part requires options.provider so the file id can be keyed safely.",
            "fileId",
            "warning",
            true,
          ),
        ],
      };
    const oldType = part.type;
    part.type = "file";
    part.mediaType ??= oldType.startsWith("image-")
      ? "image"
      : (options.defaultMediaType ?? "application/octet-stream");
    part.data = {
      type: "reference",
      reference: isRecord(part.fileId)
        ? clone(part.fileId)
        : { [options.provider as string]: clone(part.fileId) },
    };
    delete part.fileId;
    diagnostics.push(
      diagnostic(
        "content.file-id",
        `Converted ${oldType} to a provider reference.`,
        "type",
      ),
    );
    return { value: part as TOutput, changed: true, diagnostics };
  }

  const aliases: Readonly<Record<string, "data" | "url" | "reference">> = {
    "file-data": "data",
    "image-data": "data",
    "file-url": "url",
    "image-url": "url",
    "file-reference": "reference",
    "image-file-reference": "reference",
    media: "data",
  };
  if (typeof part.type === "string" && aliases[part.type]) {
    const oldType = part.type;
    const kind = aliases[oldType];
    part.type = "file";
    if (part.mediaType === undefined) {
      part.mediaType = oldType.startsWith("image-")
        ? "image"
        : (options.defaultMediaType ?? "application/octet-stream");
      if (!oldType.startsWith("image-") && oldType !== "media")
        diagnostics.push(
          diagnostic(
            "content.media-type-defaulted",
            `No mediaType was present; defaulted to ${String(part.mediaType)}.`,
            "mediaType",
            "warning",
            true,
          ),
        );
    }
    if (kind === "data") part.data = { type: "data", data: clone(part.data) };
    if (kind === "url") {
      let url = clone(part.url);
      if (typeof url === "string") {
        try {
          url = new URL(url);
        } catch {
          diagnostics.push(
            diagnostic(
              "content.url-invalid",
              "The file URL is not an absolute URL.",
              "url",
              "error",
              true,
            ),
          );
        }
      }
      part.data = { type: "url", url };
    }
    if (kind === "reference")
      part.data = {
        type: "reference",
        reference: clone(part.providerReference),
      };
    if (kind === "reference" && !isRecord(part.providerReference))
      diagnostics.push(
        diagnostic(
          "content.reference-invalid",
          "The provider reference must be a provider-to-file-id object.",
          "providerReference",
          "error",
          true,
        ),
      );
    delete part.url;
    delete part.providerReference;
    diagnostics.push(
      diagnostic(
        "content.file-alias",
        `Converted ${oldType} to the canonical file variant.`,
        "type",
      ),
    );
    return { value: part as TOutput, changed: true, diagnostics };
  }
  return { value: part as TOutput, changed: false, diagnostics };
}
