# ai-sdk-compat

Upgrade Vercel AI SDK data without breaking old chats, shared libraries, or production migrations.

```bash
npm install ai-sdk-compat
```

Zero runtime dependencies. ESM and CommonJS. Node.js 18+.

## The upgrade that passed CI—and still broke production

Your codemod updates `system` to `instructions`. TypeScript turns green. The new deployment starts normally.

Then a customer opens a six-month-old conversation. Its stored message still has top-level `content`, a `tool-invocation` part, `args`, and the old `result` state. The current UI expects `parts`, `tool-weather`, `input`, and `output-available`. Source code was migrated; persisted reality was not.

`ai-sdk-compat` is the bridge between those worlds:

```ts
import { migrateUIMessages } from "ai-sdk-compat";

const migration = migrateUIMessages(rows);

if (migration.diagnostics.some((issue) => issue.lossy)) {
  // Review before writing anything.
}

await save(migration.value);
```

It does not hide uncertainty. Every rename, conflict, malformed value, and lossy fallback is returned as a path-level diagnostic.

## What it covers

| Surface        | Legacy shape                                                         | Current shape                                            |
| -------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| Persisted text | top-level `content`                                                  | `{ type: "text", text }` part                            |
| Reasoning      | top-level `reasoning` or `{ reasoning }`                             | `{ type: "reasoning", text }`                            |
| Tools          | `tool-invocation`, `args`, `result`                                  | `tool-{name}`, `input`, `output`                         |
| Tool states    | `partial-call`, `call`, `result`                                     | `input-streaming`, `input-available`, `output-available` |
| Data messages  | `role: "data"`                                                       | assistant `data-custom` part                             |
| Call options   | `maxTokens`, `system`, experimental names                            | current AI SDK option names                              |
| Token usage    | `promptTokens`, `completionTokens`, top-level cache/reasoning tokens | current token fields and detail objects                  |
| File content   | `media`, `image-*`, `file-*`, and `*-id` variants                    | canonical `file` parts                                   |
| Results        | `fullStream`, `experimental_output` callers                          | aliases backed by current properties                     |

The implementation follows the migration contracts shipped with the AI SDK and compiles against AI SDK 6 and 7 types.

## Persisted UI messages

```ts
import { migrateUIMessages } from "ai-sdk-compat";
import type { UIMessage } from "ai";

const {
  value: messages,
  changed,
  diagnostics,
} = migrateUIMessages<UIMessage>(databaseRows, {
  idFactory: (message, index) =>
    typeof message.legacyId === "string" ? message.legacyId : `import-${index}`,
});
```

Transforms are non-mutating. Enumerable application fields are retained wherever the canonical shape can carry them. If a nested legacy field has no safe equivalent, the result includes a lossy diagnostic instead of silently pretending the conversion was exact.

When a legacy message contains both `parts` and duplicate top-level fields, `parts` is treated as authoritative and the ambiguity is reported. Use `{ preserveLegacyFields: true }` temporarily during a deliberate dual-write rollout.

### Validate with your actual schemas

The generic output parameter describes the target type; it does not perform runtime schema validation. After migration, validate with your application schemas or the AI SDK's `safeValidateUIMessages` before accepting untrusted data:

```ts
import { safeValidateUIMessages, type UIMessage } from "ai";
import { migrateUIMessages } from "ai-sdk-compat";

const migrated = migrateUIMessages<UIMessage>(unknownRows);
const validated = await safeValidateUIMessages({
  messages: migrated.value,
  tools,
  dataSchemas,
});

if (!validated.success) throw validated.error;
```

## Call options and usage

```ts
import { migrateCallOptions, migrateLanguageModelUsage } from "ai-sdk-compat";

const options = migrateCallOptions({
  system: "Be concise",
  maxTokens: 500,
  includeRawChunks: true,
}).value;
// {
//   instructions: "Be concise",
//   maxOutputTokens: 500,
//   include: { rawChunks: true }
// }

const usage = migrateLanguageModelUsage({
  promptTokens: 80,
  completionTokens: 20,
  cachedInputTokens: 30,
}).value;
// inputTokens: 80, outputTokens: 20, totalTokens: 100, plus detail objects
```

Current names win when old and new fields coexist, and the discarded conflict is marked lossy. Options that require importing an SDK helper—such as converting `maxSteps` to `stopWhen`—are intentionally left alone and flagged for manual review. AI model objects, schemas, signals, and other class instances are preserved by identity.

## File content and result aliases

```ts
import {
  migrateModelContentPart,
  withLegacyResultAliases,
} from "ai-sdk-compat";

const file = migrateModelContentPart(
  { type: "file-id", fileId: "file_123" },
  { provider: "openai", defaultMediaType: "application/pdf" },
).value;

const compatible = withLegacyResultAliases(result);
compatible.fullStream; // backed by result.stream
```

String URL aliases become `URL` instances for the current tool-output contract. JSON serialization naturally turns them back into strings. A scalar `file-id` requires an explicit provider; an existing provider-to-ID map does not.

The result adapter is a proxy rather than a shallow copy. Class prototypes, private getters, methods, promises, and stream identity remain attached to the original result.

## Audit and migrate JSON from the CLI

Start with `check`. It never writes:

```bash
npx ai-sdk-compat check messages messages.json
npx ai-sdk-compat check options call-options.json
```

Preview migrated JSON on stdout:

```bash
npx ai-sdk-compat migrate messages messages.json
```

Atomically replace a file only after a clean migration:

```bash
npx ai-sdk-compat migrate messages messages.json --write
```

`--write` refuses to run when any error or lossy diagnostic exists. After reviewing those diagnostics, an intentional migration can be forced:

```bash
npx ai-sdk-compat migrate messages messages.json --write --force
```

The CLI accepts `messages`, `options`, `usage`, and `content`. Input is limited to 64 MiB by default to avoid accidental memory exhaustion; override deliberately with `--max-bytes N`.

| Result                             | Output                              | Exit code |
| ---------------------------------- | ----------------------------------- | --------- |
| Already current                    | `compatible`                        | 0         |
| Transform available                | `migration required`                | 1         |
| Manual-only or unsafe finding      | `manual review required`            | 1         |
| Forced write with remaining errors | file is written, diagnostics remain | 1         |
| Invalid invocation                 | usage or error message              | 1 or 2    |

## A production migration playbook

1. Export a representative sample, including old tool calls, files, reasoning, and custom data parts.
2. Run `check` and group diagnostics by stable `code`.
3. Preview the transformation and validate it with your real tool and data schemas.
4. Add runtime conversion on reads.
5. Dual-write old and new storage only if rollback requirements justify the complexity.
6. Backfill in bounded, transactional batches with backups and metrics.
7. Switch reads to the new format, monitor failures, then remove the compatibility layer.

The package handles object conversion. Transactions, backups, concurrency control, and application-specific schema validation stay with the caller.

## API

Every migration function returns:

```ts
interface MigrationResult<T> {
  value: T;
  changed: boolean;
  diagnostics: readonly Diagnostic[];
}
```

| Export                      | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `migrateUIMessage`          | Migrate or audit one persisted UI message                           |
| `migrateUIMessages`         | Migrate an array with indexed diagnostic paths                      |
| `isLegacyUIMessage`         | Detect known pre-parts persistence shapes                           |
| `migrateCallOptions`        | Normalize renamed generation and streaming options                  |
| `migrateLanguageModelUsage` | Normalize v4-v7 token usage shapes                                  |
| `migrateModelContentPart`   | Canonicalize image, media, file, URL, and provider-reference parts  |
| `withLegacyResultAliases`   | Expose old result names without damaging class instances or streams |
| `getFinalStep`              | Read `finalStep`, falling back to the last item in `steps`          |

Diagnostics contain a stable `code`, human message, exact `path`, `severity`, and `lossy` boolean.

## Non-goals

- Rewriting TypeScript source; use the official AI SDK codemod for that.
- Guessing tool schemas, provider names, or missing business identifiers.
- Hiding malformed data behind type assertions.
- Keeping a compatibility layer forever. Migrate, validate, backfill, and remove it.

## Development and security

```bash
npm ci
npm run verify
```

The release gate runs formatting, strict linting, type contracts, property tests, coverage thresholds, ESM/CommonJS builds, CLI safety tests, and tarball inspection. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT © Atomics Hub
