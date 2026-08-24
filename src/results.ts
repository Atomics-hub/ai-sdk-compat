import { isRecord } from "./internal.js";
import type { AliasOptions, LegacyResultAliases } from "./types.js";

/** Return result.finalStep or fall back to the last accumulated step. */
export function getFinalStep(result: unknown): unknown {
  if (!isRecord(result)) return undefined;
  if (result.finalStep !== undefined) return result.finalStep;
  if (Array.isArray(result.steps)) return result.steps.at(-1);
  return undefined;
}

/** Add virtual legacy result names without copying or mutating the result instance. */
export function withLegacyResultAliases<T extends object>(
  result: T,
  options: AliasOptions = {},
): T & LegacyResultAliases {
  const enumerable = options.enumerable ?? false;
  const aliases: Readonly<Record<string, string>> = {
    fullStream: "stream",
    experimental_output: "output",
  };
  const boundMethods = new Map<PropertyKey, unknown>();
  const resolve = (property: PropertyKey): PropertyKey =>
    typeof property === "string" &&
    !(property in result) &&
    aliases[property] !== undefined
      ? aliases[property]
      : property;

  return new Proxy(result, {
    get(target, property) {
      const resolved = resolve(property);
      const value = Reflect.get(target, resolved, target) as unknown;
      if (typeof value !== "function") return value;
      if (!boundMethods.has(resolved))
        boundMethods.set(resolved, value.bind(target));
      return boundMethods.get(resolved);
    },
    has(target, property) {
      return Reflect.has(target, resolve(property));
    },
    set(target, property, value) {
      return Reflect.set(target, resolve(property), value, target);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      if (!enumerable || !Object.isExtensible(target)) return keys;
      for (const [legacy, current] of Object.entries(aliases))
        if (!(legacy in target) && current in target) keys.push(legacy);
      return keys;
    },
    getOwnPropertyDescriptor(target, property) {
      const existing = Reflect.getOwnPropertyDescriptor(target, property);
      if (existing) return existing;
      const resolved = resolve(property);
      if (resolved === property || !Object.isExtensible(target))
        return undefined;
      return {
        configurable: true,
        enumerable,
        get: () => Reflect.get(target, resolved, target) as unknown,
      };
    },
  });
}
