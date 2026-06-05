import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { X402ChallengeClient } from "../src/x402/client.js";

const servers: Array<{ close: () => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe("x402 foundation", () => {
  it("loads Casper x402 configuration from environment", () => {
    const config = loadConfig({
      X402_FACILITATOR_URL: "http://localhost:4022",
      X402_RESOURCE_DEMO_URL: "http://localhost:4021/weather",
      X402_ASSET_PACKAGE: "asset-package-hash",
      CASPER_CAIP2_CHAIN_ID: "casper:casper-test"
    });

    expect(config.x402.facilitatorUrl).toBe("http://localhost:4022");
    expect(config.x402.resourceDemoUrl).toBe("http://localhost:4021/weather");
    expect(config.x402.assetPackage).toBe("asset-package-hash");
    expect(config.casper.caip2ChainId).toBe("casper:casper-test");
  });

  it("parses an HTTP 402 challenge without attempting settlement", async () => {
    const url = await startServer(402, {
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "casper-test",
          maxAmountRequired: "0.01",
          resource: "weather",
          asset: "asset-package-hash",
          payTo: "casper-payee"
        }
      ]
    });
    const client = new X402ChallengeClient();

    const challenge = await client.requestChallenge({ method: "GET", url });

    expect(challenge.status).toBe("payment_required");
    expect(challenge.status_code).toBe(402);
    expect(challenge.requirements).toMatchObject({ x402Version: 1 });
    expect(challenge.settlement_status).toBe("not_started");
  });

  it("hashes a free response body and marks payment as unnecessary", async () => {
    const url = await startServer(200, { weather: "sunny" });
    const client = new X402ChallengeClient();

    const result = await client.requestChallenge({ method: "GET", url });

    expect(result.status).toBe("free_response");
    expect(result.status_code).toBe(200);
    expect(result.response_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

async function startServer(statusCode: number, body: unknown): Promise<string> {
  const server = createServer((_, response) => {
    response.writeHead(statusCode, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return `http://127.0.0.1:${address.port}/weather`;
}
