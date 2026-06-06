const REDACTED = "[redacted]";
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 4096;

export function redactX402Value(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactX402Value(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(record)) {
      redacted[key] = isSensitiveKey(key) ? REDACTED : redactX402Value(nested, depth + 1);
    }

    return redacted;
  }

  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}[truncated]`;
  }

  return value;
}

function isSensitiveKey(key: string): boolean {
  if (/(_hash|Hash|hash)$/.test(key)) {
    return false;
  }

  return /secret|token|key|password|private|payload|credential|authorization|signature|value/i.test(key);
}
