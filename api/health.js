const TARGET_ENV_KEYS = ["MAINSPRING_DEMO_API_URL", "X402_DEMO_API_URL"];

export default async function handler(request, response) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const target = getTargetApiUrl();
  if (!target) {
    response.status(503).json({
      ok: false,
      error: "demo_api_not_configured",
      message: "Set MAINSPRING_DEMO_API_URL to the public x402 demo API origin."
    });
    return;
  }

  try {
    const upstream = await fetch(`${target}/health`);
    const contentType = upstream.headers.get("content-type") || "application/json";
    response.status(upstream.status).setHeader("content-type", contentType);
    response.send(await upstream.text());
  } catch (error) {
    response.status(502).json({
      ok: false,
      error: "demo_api_unavailable",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function getTargetApiUrl() {
  for (const key of TARGET_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value.replace(/\/+$/, "");
    }
  }
  return "";
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}
