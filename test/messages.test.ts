import { describe, expect, it } from "vitest";
import {
  isLegacyUIMessage,
  migrateUIMessage,
  migrateUIMessages,
} from "../src/messages.js";

describe("UI message migration", () => {
  it("converts all persisted v4 top-level fields without mutating input", () => {
    const input = {
      role: "assistant",
      content: "done",
      reasoning: "thinking",
      metadata: { tenant: "a" },
      toolInvocations: [
        {
          toolCallId: "1",
          toolName: "weather",
          args: { city: "LA" },
          state: "result",
          result: 72,
        },
      ],
    };
    const snapshot = structuredClone(input);
    const result = migrateUIMessage(input, 4);
    expect(input).toEqual(snapshot);
    expect(result.value).toMatchObject({
      id: "msg-4",
      role: "assistant",
      metadata: { tenant: "a" },
      parts: [
        { type: "reasoning", text: "thinking" },
        {
          type: "tool-weather",
          toolCallId: "1",
          input: { city: "LA" },
          output: 72,
          state: "output-available",
        },
        { type: "text", text: "done" },
      ],
    });
    expect(result.value).not.toHaveProperty("content");
  });

  it("converts legacy parts, data messages, and preserves modern messages", () => {
    expect(
      migrateUIMessage({ role: "assistant", content: "content only" }).value,
    ).toMatchObject({ parts: [{ type: "text", text: "content only" }] });
    const legacy = migrateUIMessage({
      id: "x",
      role: "assistant",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c",
            toolName: "search",
            args: {},
            state: "call",
          },
        },
        { type: "reasoning", reasoning: "why", details: [] },
        {
          type: "source",
          source: { id: "s", url: "https://example.com", title: "Source" },
        },
        { type: "file", mimeType: "text/plain", data: "data:text/plain,hi" },
      ],
    });
    expect(legacy.value.parts).toEqual([
      {
        type: "tool-search",
        toolCallId: "c",
        input: {},
        state: "input-available",
      },
      { type: "reasoning", text: "why" },
      {
        type: "source-url",
        sourceId: "s",
        url: "https://example.com",
        title: "Source",
      },
      { type: "file", mediaType: "text/plain", url: "data:text/plain,hi" },
    ]);
    expect(
      migrateUIMessage({ role: "data", data: { status: "ok" } }).value,
    ).toMatchObject({
      role: "assistant",
      parts: [{ type: "data-custom", data: { status: "ok" } }],
    });
    const modern = {
      id: "m",
      role: "user",
      parts: [{ type: "text", text: "hi" }],
    };
    expect(migrateUIMessage(modern)).toEqual({
      value: modern,
      changed: false,
      diagnostics: [],
    });
  });

  it("surfaces lossy states, custom ids, invalid values, and array paths", () => {
    const result = migrateUIMessages(
      [
        { role: "assistant", toolInvocations: [{ state: "alien", args: 1 }] },
        "bad",
      ],
      {
        idFactory: (_message, index) => `custom-${String(index)}`,
        preserveLegacyFields: true,
      },
    );
    expect(result.value[0]).toMatchObject({
      id: "custom-0",
      toolInvocations: [{ state: "alien" }],
    });
    expect(
      result.diagnostics.some(
        (entry) => entry.lossy && entry.path.includes("messages[0]"),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (entry) => entry.severity === "error" && entry.path === "messages[1]",
      ),
    ).toBe(true);
    expect(isLegacyUIMessage(null)).toBe(false);
  });

  it("validates modern messages and preserves extension fields", () => {
    const modern = migrateUIMessage(
      { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      2,
    );
    expect(modern.value.id).toBe("msg-2");
    expect(modern.diagnostics.some((entry) => entry.severity === "error")).toBe(
      false,
    );

    const invalid = migrateUIMessage({ id: "x", role: "robot", parts: [null] });
    expect(invalid.changed).toBe(false);
    expect(
      invalid.diagnostics.filter((entry) => entry.severity === "error"),
    ).toHaveLength(2);

    const legacy = migrateUIMessage({
      id: "x",
      role: "assistant",
      content: "duplicate",
      parts: [
        {
          type: "source",
          custom: 1,
          source: { id: "s", url: "https://x.test", extra: true },
        },
        {
          type: "file",
          mimeType: "text/plain",
          data: "data:,x",
          filename: "x.txt",
        },
        {
          type: "tool-invocation",
          toolInvocation: { toolName: "search", args: {}, custom: 2 },
        },
      ],
    });
    expect(legacy.value.parts).toMatchObject([
      { type: "source-url", custom: 1 },
      { type: "file", filename: "x.txt" },
      { type: "tool-search", custom: 2, state: "input-available" },
    ]);
    expect(
      legacy.diagnostics.some(
        (entry) => entry.code === "message.parts-authoritative" && entry.lossy,
      ),
    ).toBe(true);
    expect(
      legacy.diagnostics.some(
        (entry) =>
          entry.code === "message.tool-call-id-missing" &&
          entry.severity === "error",
      ),
    ).toBe(true);
  });
});
