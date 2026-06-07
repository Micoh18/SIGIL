export function normalizeHttpMethod(method: string): string {
  return method.trim().toUpperCase();
}

export function normalizeMethodForUrl(method: string, url: string): string {
  const normalized = normalizeHttpMethod(method);
  return isPostOnlyPaymentActionUrl(url) && normalized === "GET" ? "POST" : normalized;
}

export function normalizeAllowedMethodsForUrls(methods: string[], urls: string[]): string[] {
  const hasPostOnlyPaymentAction = urls.some(isPostOnlyPaymentActionUrl);
  const normalized = methods.map((method) => {
    const upper = normalizeHttpMethod(method);
    return hasPostOnlyPaymentAction && upper === "GET" ? "POST" : upper;
  });

  return [...new Set(normalized)].sort();
}

function isPostOnlyPaymentActionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const segments = url.pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);

    return segments.includes("payment-fetch");
  } catch {
    return value.toLowerCase().includes("payment-fetch");
  }
}
