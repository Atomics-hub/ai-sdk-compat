import type { Diagnostic, DiagnosticSeverity, UnknownRecord } from "./types.js";

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clone<T>(value: T): T {
  return cloneValue(value, new WeakMap<object, unknown>());
}

function cloneValue<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (typeof value !== "object" || value === null) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;
  if (value instanceof Date) return new Date(value) as T;
  if (value instanceof URL) return new URL(value.href) as T;
  if (value instanceof Uint8Array) return value.slice() as T;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(cloneValue(entry, seen));
    return copy as T;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return value;

  const copy = Object.create(prototype) as UnknownRecord;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    copy[key as keyof UnknownRecord] = cloneValue(
      (value as UnknownRecord)[key as keyof UnknownRecord],
      seen,
    );
  }
  return copy as T;
}

export function diagnostic(
  code: string,
  message: string,
  path: string,
  severity: DiagnosticSeverity = "info",
  lossy = false,
): Diagnostic {
  return { code, message, path, severity, lossy };
}

export function pathJoin(base: string, key: string | number): string {
  if (typeof key === "number") return `${base}[${String(key)}]`;
  return base ? `${base}.${key}` : key;
}

export function hasOwn(object: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
