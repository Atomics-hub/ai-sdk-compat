import { describe, expect, it } from "vitest";
import { migrateModelContentPart } from "../src/content.js";
import { migrateCallOptions } from "../src/options.js";
import { getFinalStep, withLegacyResultAliases } from "../src/results.js";
import { migrateLanguageModelUsage } from "../src/usage.js";

describe("call options", () => {
  it("normalizes v4-v7 names and preserves current values on conflict", () => {
    const input = {
      maxTokens: 100,
      system: "old",
      instructions: "new",
      experimental_output: "schema",
      experimental_telemetry: { functionId: "x" },
      experimental_include: { requestBody: true },
      includeRawChunks: true,
      maxSteps: 3,
      prepareStep: () => ({}),
    };
    const result = migrateCallOptions(input);
    expect(result.value).toMatchObject({
      maxOutputTokens: 100,
      instructions: "new",
      output: "schema",
      telemetry: { functionId: "x" },
      include: { requestBody: true, rawChunks: true },
      maxSteps: 3,
    });
    expect(result.value).not.toHaveProperty("system");
    expect(result.diagnostics.filter((entry) => entry.lossy)).toHaveLength(3);
    expect(input).toHaveProperty("system");
  });

  it("handles invalid options and include conflicts", () => {
    expect(migrateCallOptions(null).diagnostics[0]?.severity).toBe("error");
    const result = migrateCallOptions({
      include: { rawChunks: false },
      includeRawChunks: true,
    });
    expect(result.value).toEqual({ include: { rawChunks: false } });
    expect(
      result.diagnostics.some((entry) => entry.code.endsWith("conflict")),
    ).toBe(true);
    const manual = migrateCallOptions({ maxSteps: 3 });
    expect(manual.changed).toBe(false);
    expect(manual.diagnostics[0]?.lossy).toBe(true);
  });

  it("preserves class instances, cycles, and symbol extension fields", () => {
    class Model {
      name = "model";
    }
    const model = new Model();
    const symbol = Symbol("extension");
    const input: Record<PropertyKey, unknown> = { system: "old", model };
    input.self = input;
    input[symbol] = { enabled: true };
    const result = migrateCallOptions(input).value as Record<
      PropertyKey,
      unknown
    >;
    expect(result.model).toBe(model);
    expect(result.self).toBe(result);
    expect(result[symbol]).toEqual({ enabled: true });
  });
});

describe("usage and content", () => {
  it("moves legacy usage details without overwriting new data", () => {
    const result = migrateLanguageModelUsage({
      inputTokens: 10,
      cachedInputTokens: 4,
      reasoningTokens: 3,
      inputTokenDetails: { cacheReadTokens: 5 },
    });
    expect(result.value).toMatchObject({
      inputTokens: 10,
      inputTokenDetails: { cacheReadTokens: 5 },
      outputTokenDetails: { reasoningTokens: 3 },
    });
    expect(migrateLanguageModelUsage("bad").diagnostics[0]?.severity).toBe(
      "error",
    );
    const v4 = migrateLanguageModelUsage({
      promptTokens: 4,
      completionTokens: 6,
    });
    expect(v4.value).toMatchObject({
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      inputTokenDetails: {},
      outputTokenDetails: {},
    });
    expect(v4.changed).toBe(true);
    expect(
      migrateLanguageModelUsage(JSON.parse(JSON.stringify(v4.value))).changed,
    ).toBe(false);
    const incomplete = migrateLanguageModelUsage({ inputTokens: 1 });
    expect(
      incomplete.diagnostics.some(
        (entry) => entry.code === "usage.total-missing",
      ),
    ).toBe(true);
  });

  it.each([
    [
      { type: "image", image: "bytes" },
      { type: "file", mediaType: "image", data: "bytes" },
    ],
    [
      { type: "image-url", url: "https://x.test/a.png" },
      {
        type: "file",
        mediaType: "image",
        data: { type: "url", url: new URL("https://x.test/a.png") },
      },
    ],
    [
      { type: "file-data", data: "abc", mediaType: "text/plain" },
      {
        type: "file",
        data: { type: "data", data: "abc" },
        mediaType: "text/plain",
      },
    ],
    [
      {
        type: "file-reference",
        providerReference: { openai: "f1" },
        mediaType: "text/plain",
      },
      {
        type: "file",
        data: { type: "reference", reference: { openai: "f1" } },
        mediaType: "text/plain",
      },
    ],
  ])("migrates model content %#", (input, expected) => {
    expect(migrateModelContentPart(input).value).toEqual(expected);
  });
  it("leaves current content alone and rejects invalid content", () => {
    expect(migrateModelContentPart({ type: "text", text: "ok" }).changed).toBe(
      false,
    );
    expect(migrateModelContentPart(1).diagnostics[0]?.severity).toBe("error");
    expect(
      migrateModelContentPart({ type: "file-id", fileId: "f1" }).changed,
    ).toBe(false);
    expect(
      migrateModelContentPart(
        { type: "file-id", fileId: "f1" },
        { provider: "openai" },
      ).value,
    ).toMatchObject({
      type: "file",
      mediaType: "application/octet-stream",
      data: { type: "reference", reference: { openai: "f1" } },
    });
    expect(
      migrateModelContentPart({
        type: "file-url",
        url: "relative",
      }).diagnostics.some((entry) => entry.severity === "error"),
    ).toBe(true);
    expect(
      migrateModelContentPart({
        type: "media",
        data: "abc",
        mediaType: "image/png",
      }).value,
    ).toEqual({
      type: "file",
      data: { type: "data", data: "abc" },
      mediaType: "image/png",
    });
    expect(
      migrateModelContentPart({ type: "file-id", fileId: { openai: "f1" } })
        .value,
    ).toMatchObject({
      data: { type: "reference", reference: { openai: "f1" } },
    });
  });
});

describe("result adapters", () => {
  it("finds final steps and supplies non-enumerable legacy aliases", () => {
    const stream = {
      value: 1,
      next: () => Promise.resolve({ done: true as const, value: undefined }),
    };
    const result = withLegacyResultAliases({ stream, output: { ok: true } });
    expect(result.fullStream).toEqual(stream);
    expect(result.fullStream).toBe(stream);
    expect(result.experimental_output).toEqual({ ok: true });
    expect(Object.keys(result)).toEqual(["stream", "output"]);
    expect(getFinalStep({ finalStep: 3, steps: [1, 2] })).toBe(3);
    expect(getFinalStep({ steps: [1, 2] })).toBe(2);
    expect(getFinalStep(null)).toBeUndefined();
  });

  it("preserves class getters, private methods, identity semantics, and enumerable aliases", () => {
    class Result {
      #value = 7;
      stream = { id: "stream" };
      get output() {
        return this.#value;
      }
      read() {
        return this.#value;
      }
    }
    const original = new Result();
    const compatible = withLegacyResultAliases(original, { enumerable: true });
    expect(compatible).toBeInstanceOf(Result);
    expect(compatible.experimental_output).toBe(7);
    expect(compatible.fullStream).toBe(original.stream);
    expect(compatible.read()).toBe(7);
    expect("fullStream" in compatible).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(compatible, "fullStream")?.enumerable,
    ).toBe(true);
    expect(Object.keys(compatible)).toContain("fullStream");
    expect(Reflect.set(compatible, "fullStream", { id: "next" })).toBe(true);
    expect(original.stream).toEqual({ id: "next" });
    expect(getFinalStep({})).toBeUndefined();
  });
});
