import fc from "fast-check";
import { expect, it } from "vitest";
import { migrateUIMessage } from "../src/messages.js";
import { migrateCallOptions } from "../src/options.js";
import { migrateLanguageModelUsage } from "../src/usage.js";

it("is idempotent for migrated legacy messages", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (content, id) => {
      const first = migrateUIMessage({ id, role: "assistant", content });
      const second = migrateUIMessage(first.value);
      expect(second.value).toEqual(first.value);
      expect(second.changed).toBe(false);
    }),
    { numRuns: 500 },
  );
});

it("never mutates JSON-compatible option objects", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (value) => {
      const input = { system: "x", include: { custom: value } };
      const before = structuredClone(input);
      migrateCallOptions(input);
      expect(input).toEqual(before);
    }),
    { numRuns: 500 },
  );
});

it("is idempotent after JSON serialization of migrated v4 usage", () => {
  fc.assert(
    fc.property(fc.nat(), fc.nat(), (promptTokens, completionTokens) => {
      const first = migrateLanguageModelUsage({
        promptTokens,
        completionTokens,
      });
      const persisted: unknown = JSON.parse(JSON.stringify(first.value));
      const second = migrateLanguageModelUsage(persisted);
      expect(second.value).toEqual(persisted);
      expect(second.changed).toBe(false);
    }),
    { numRuns: 500 },
  );
});
