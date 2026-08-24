import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const esm = await import(new URL("dist/index.js", root));
const require = createRequire(import.meta.url);
const cjs = require(fileURLToPath(new URL("dist/index.cjs", root)));

for (const api of [esm, cjs]) {
  const result = api.migrateUIMessage({ role: "assistant", content: "hello" });
  assert.equal(result.value.parts[0].text, "hello");
  assert.equal(result.changed, true);

  class ClassResult {
    #value = 7;
    stream = { id: "stream" };
    get output() {
      return this.#value;
    }
    read() {
      return this.#value;
    }
  }
  const original = new ClassResult();
  const compatible = api.withLegacyResultAliases(original);
  assert.equal(compatible.experimental_output, 7);
  assert.equal(compatible.fullStream, original.stream);
  assert.equal(compatible.read(), 7);
}

const directory = mkdtempSync(join(tmpdir(), "ai-sdk-compat-"));
const fixture = join(directory, "messages.json");
writeFileSync(
  fixture,
  JSON.stringify([{ role: "assistant", content: "hello" }]),
);
const cli = new URL("dist/cli.js", root);

let checkFailed = false;
try {
  execFileSync(process.execPath, [cli.pathname, "check", "messages", fixture], {
    stdio: "pipe",
  });
} catch (error) {
  checkFailed =
    error.status === 1 &&
    error.stdout.toString().includes("migration required");
}
assert.equal(
  checkFailed,
  true,
  "check must return 1 when migration is required",
);
execFileSync(
  process.execPath,
  [cli.pathname, "migrate", "messages", fixture, "--write"],
  { stdio: "pipe" },
);
const migrated = JSON.parse(readFileSync(fixture, "utf8"));
assert.equal(migrated[0].parts[0].text, "hello");
assert.equal(
  execFileSync(process.execPath, [cli.pathname, "check", "messages", fixture], {
    encoding: "utf8",
  }),
  "compatible\n",
);

const optionsFixture = join(directory, "options.json");
writeFileSync(optionsFixture, JSON.stringify({ maxSteps: 3 }));
let manualReview = false;
try {
  execFileSync(
    process.execPath,
    [cli.pathname, "check", "options", optionsFixture],
    {
      stdio: "pipe",
    },
  );
} catch (error) {
  manualReview =
    error.status === 1 &&
    error.stdout.toString().includes("manual review required");
}
assert.equal(
  manualReview,
  true,
  "manual-only diagnostics must not print compatible",
);

const unsafeFixture = join(directory, "unsafe.json");
const unsafeSource = JSON.stringify([
  {
    id: "x",
    role: "assistant",
    toolInvocations: [{ toolName: "search", args: {}, state: "call" }],
  },
]);
writeFileSync(unsafeFixture, unsafeSource);
let refusedWrite = false;
try {
  execFileSync(
    process.execPath,
    [cli.pathname, "migrate", "messages", unsafeFixture, "--write"],
    { stdio: "pipe" },
  );
} catch (error) {
  refusedWrite =
    error.status === 1 && error.stderr.toString().includes("Refusing --write");
}
assert.equal(refusedWrite, true, "unsafe --write must be refused");
assert.equal(readFileSync(unsafeFixture, "utf8"), unsafeSource);
try {
  execFileSync(
    process.execPath,
    [cli.pathname, "migrate", "messages", unsafeFixture, "--write", "--force"],
    { stdio: "pipe" },
  );
} catch (error) {
  assert.equal(
    error.status,
    1,
    "forced unsafe write must retain a failing exit code",
  );
}
assert.notEqual(readFileSync(unsafeFixture, "utf8"), unsafeSource);

let sizeGuard = false;
try {
  execFileSync(
    process.execPath,
    [cli.pathname, "check", "messages", fixture, "--max-bytes", "1"],
    { stdio: "pipe" },
  );
} catch (error) {
  sizeGuard =
    error.status === 1 && error.stderr.toString().includes("exceeding");
}
assert.equal(
  sizeGuard,
  true,
  "oversized input must be rejected before parsing",
);

process.stdout.write(
  "ESM, CommonJS, CLI status, size guard, safe write, forced write, and atomic write verified.\n",
);
