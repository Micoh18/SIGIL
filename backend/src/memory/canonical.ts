import type { JsonObject, JsonValue } from "./types.js";

export function toJsonValue(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number at ${path}`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const output: JsonObject = {};

    for (const [key, item] of Object.entries(objectValue)) {
      if (item === undefined) {
        continue;
      }

      output[key] = toJsonValue(item, `${path}.${key}`);
    }

    return output;
  }

  throw new Error(`Unsupported JSON value at ${path}`);
}

export function toJsonObject(value: unknown, path = "$"): JsonObject {
  const json = toJsonValue(value, path);

  if (json === null || Array.isArray(json) || typeof json !== "object") {
    throw new Error(`Expected JSON object at ${path}`);
  }

  return json;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(toJsonValue(value)));
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === "object") {
    const sorted: JsonObject = {};

    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJsonValue(value[key]);
    }

    return sorted;
  }

  return value;
}

