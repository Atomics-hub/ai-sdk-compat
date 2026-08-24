export type DiagnosticSeverity = "info" | "warning" | "error";

/** A machine-readable finding emitted while auditing or migrating a value. */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly severity: DiagnosticSeverity;
  readonly lossy: boolean;
}

export interface MigrationResult<T> {
  readonly value: T;
  readonly changed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface MessageMigrationOptions {
  readonly idFactory?: (
    message: Record<string, unknown>,
    index: number,
  ) => string;
  readonly preserveLegacyFields?: boolean;
}

export interface AliasOptions {
  /** Include virtual aliases in enumerable-key operations such as Object.keys. */
  readonly enumerable?: boolean;
}

export interface LegacyResultAliases {
  readonly fullStream?: unknown;
  readonly experimental_output?: unknown;
}

export interface ContentMigrationOptions {
  /** Used when a legacy non-image file has no media type. */
  readonly defaultMediaType?: string;
  /** Provider key used to convert a scalar legacy file id. */
  readonly provider?: string;
}

export type UnknownRecord = Record<string, unknown>;
