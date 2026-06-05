import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuditService } from "../src/audit/service.js";
import { FileAuditStore } from "../src/audit/store.js";
import { GrimoireService } from "../src/grimoire/service.js";
import { FileGrimoireStore } from "../src/grimoire/store.js";
import type { PolicySetInput } from "../src/grimoire/types.js";
import { registerAuditTools } from "../src/mcp/auditTools.js";
import { registerGrimoireTools } from "../src/mcp/grimoireTools.js";
import { registerPaymentTools } from "../src/mcp/paymentTools.js";
import { FileMemoryStore } from "../src/memory/store.js";
import { PaymentService } from "../src/payments/service.js";
import { FilePaymentStore } from "../src/payments/store.js";
import type { PaymentDenialReason, PaymentFetchInput } from "../src/payments/types.js";
import type { X402ChallengeRequest, X402ChallengeResult } from "../src/x402/client.js";

type CapturedTool = {
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

describe("security leak guards", () => {
  it("does not expose secret values through grimoire tool outputs or audit tail", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-security-grimoire-"));
    const audit = new AuditService(new FileAuditStore(dataDir));
    const grimoire = new GrimoireService(
      new FileGrimoireStore(dataDir),
      Buffer.alloc(32, 1),
      audit
    );
    const grimoireTools = captureTools((server) => registerGrimoireTools(server, grimoire));
    const auditTools = captureTools((server) => registerAuditTools(server, audit));
    const secretValue = "task05-super-secret-value";

    const putOutput = await callJsonTool(grimoireTools.get("grimoire.secret.put"), {
      agent_id: "agent-demo-1",
      name: "weather-key",
      type: "api_key",
      value: secretValue,
      scopes: ["weather:read"]
    });
    const listOutput = await callJsonTool(grimoireTools.get("grimoire.secret.list"), {
      agent_id: "agent-demo-1"
    });
    const auditOutput = await callJsonTool(auditTools.get("audit.tail"), {
      agent_id: "agent-demo-1",
      limit: 20
    });

    expect(JSON.stringify(putOutput)).not.toContain(secretValue);
    expect(JSON.stringify(listOutput)).not.toContain(secretValue);
    expect(JSON.stringify(auditOutput)).not.toContain(secretValue);
  });

  it("does not place secret values in memory bodies during payment flows", async () => {
    const { payment, grimoire, memoryStore } = await createPaymentFixture();
    const secretValue = "task05-payment-memory-secret";

    await grimoire.putSecret({
      agent_id: "agent-demo-1",
      name: "x402-client-key",
      type: "x402_client_key_ref",
      value: secretValue,
      scopes: ["x402:sign"]
    });

    await payment.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01"
    });

    const memoryBodies = (await memoryStore.list("agent-demo-1")).map((memory) => memory.body);
    expect(JSON.stringify(memoryBodies)).not.toContain(secretValue);
  });

  it("redacts sensitive x402 requirement fields from payment MCP outputs and audit", async () => {
    const secretValue = "task11-x402-private-key-value";
    const requirements = {
      x402Version: 1,
      privateKey: secretValue,
      accepts: [
        {
          scheme: "exact",
          network: "casper-test",
          maxAmountRequired: "0.01",
          resource: "http://localhost:4021/weather",
          asset: "asset-package-hash",
          payTo: "casper-payee",
          extra: {
            api_key: secretValue
          }
        }
      ]
    };
    const { payment, audit } = await createPaymentFixture(
      {},
      {
        challengeClient: {
          async requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult> {
            return {
              status: "payment_required",
              status_code: 402,
              requirements,
              requirements_json: JSON.stringify(requirements),
              requirements_source: "json-body",
              raw_body: JSON.stringify(requirements),
              facilitator_url: "http://localhost:4022",
              resource_url: "http://localhost:4021/weather",
              request_url: input.url,
              settlement_status: "not_started"
            };
          }
        }
      }
    );
    const paymentTools = captureTools((server) => registerPaymentTools(server, payment));
    const auditTools = captureTools((server) => registerAuditTools(server, audit));

    const fetchOutput = await callJsonTool<{ payment_id: string }>(
      paymentTools.get("payment.fetch"),
      {
        agent_id: "agent-demo-1",
        policy_id: "pol-demo",
        method: "GET",
        url: "http://localhost:4021/weather",
        expected_amount: "0.01",
        request_challenge: true
      }
    );
    const receiptOutput = await callJsonTool(paymentTools.get("payment.receipt"), {
      payment_id: fetchOutput.payment_id
    });
    const auditOutput = await callJsonTool(auditTools.get("audit.tail"), {
      agent_id: "agent-demo-1",
      limit: 20
    });

    expect(JSON.stringify(fetchOutput)).not.toContain(secretValue);
    expect(JSON.stringify(receiptOutput)).not.toContain(secretValue);
    expect(JSON.stringify(auditOutput)).not.toContain(secretValue);
    expect(JSON.stringify(fetchOutput)).toContain("[redacted]");
  });

  it("bounds large audit metadata and keeps sensitive fields redacted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-security-audit-"));
    const audit = new AuditService(new FileAuditStore(dataDir));
    const secretValue = "task05-audit-secret-value";

    await audit.record({
      agent_id: "agent-demo-1",
      event_type: "security.large_metadata",
      subject_type: "test",
      metadata: {
        note: "x".repeat(50_000),
        api_key: secretValue,
        nested: {
          token_value: secretValue
        },
        items: Array.from({ length: 100 }, (_, index) => ({ index }))
      }
    });

    const tail = await audit.tail({ agent_id: "agent-demo-1", limit: 1 });
    const metadataJson = JSON.stringify(tail.events[0]?.metadata);

    expect(metadataJson).not.toContain(secretValue);
    expect(metadataJson.length).toBeLessThan(20_000);
    expect(metadataJson).toContain("[truncated]");
    expect(metadataJson).toContain("[redacted]");
  });
});

describe("payment policy denials", () => {
  it.each([
    {
      name: "URL mismatch",
      input: { url: "http://localhost:4021/other" },
      reason: "url_not_allowed"
    },
    {
      name: "method mismatch",
      input: { method: "POST" },
      reason: "method_not_allowed"
    },
    {
      name: "disabled policy",
      policy: { enabled: false },
      input: {},
      reason: "policy_disabled"
    },
    {
      name: "amount over limit",
      input: { expected_amount: "0.06" },
      reason: "amount_over_limit"
    },
    {
      name: "invalid decimal input",
      input: { expected_amount: "0..01" },
      reason: "invalid_amount"
    },
    {
      name: "negative decimal input",
      input: { expected_amount: "-0.01" },
      reason: "invalid_amount"
    }
  ] satisfies Array<{
    name: string;
    policy?: Partial<PolicySetInput>;
    input: Partial<PaymentFetchInput>;
    reason: PaymentDenialReason;
  }>)("denies cleanly for $name", async ({ policy, input, reason }) => {
    const { payment, paymentStore } = await createPaymentFixture(policy);

    const result = await payment.fetch({
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      method: "GET",
      url: "http://localhost:4021/weather",
      expected_amount: "0.01",
      ...input
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe(reason);
    }

    const intent = await paymentStore.getIntent(result.payment_id);
    expect(intent).toMatchObject({
      status: "policy_denied",
      denial_reason: reason
    });
  });
});

describe("MCP input safety", () => {
  it("rejects empty payment URLs and methods at the tool schema", async () => {
    const { payment } = await createPaymentFixture();
    const paymentTools = captureTools((server) => registerPaymentTools(server, payment));
    const paymentFetch = requireTool(paymentTools.get("payment.fetch"));

    expect(
      validateToolInput(paymentFetch, {
        agent_id: "agent-demo-1",
        policy_id: "pol-demo",
        method: "GET",
        url: ""
      }).success
    ).toBe(false);
    expect(
      validateToolInput(paymentFetch, {
        agent_id: "agent-demo-1",
        policy_id: "pol-demo",
        method: "   ",
        url: "http://localhost:4021/weather"
      }).success
    ).toBe(false);
  });

  it("rejects empty policy URLs and methods at the tool schema", () => {
    const grimoire = new GrimoireService(
      new FileGrimoireStore(join(tmpdir(), "sigil-security-unused")),
      Buffer.alloc(32, 1)
    );
    const grimoireTools = captureTools((server) => registerGrimoireTools(server, grimoire));
    const policySet = requireTool(grimoireTools.get("grimoire.policy.set"));
    const baseInput = {
      agent_id: "agent-demo-1",
      policy_id: "pol-demo",
      allowed_urls: ["http://localhost:4021/weather"],
      allowed_methods: ["GET"],
      allowed_asset: { caip2_chain_id: "casper:casper-test" },
      max_amount_per_call: "0.05",
      max_amount_per_period: "1.00",
      period_seconds: 86400,
      secret_scopes: ["x402:sign"]
    };

    expect(validateToolInput(policySet, { ...baseInput, allowed_urls: [""] }).success).toBe(false);
    expect(validateToolInput(policySet, { ...baseInput, allowed_methods: ["  "] }).success).toBe(
      false
    );
  });
});

async function createPaymentFixture(
  policyOverrides: Partial<PolicySetInput> = {},
  options: {
    challengeClient?: {
      requestChallenge(input: X402ChallengeRequest): Promise<X402ChallengeResult>;
    };
  } = {}
): Promise<{
  audit: AuditService;
  grimoire: GrimoireService;
  memoryStore: FileMemoryStore;
  payment: PaymentService;
  paymentStore: FilePaymentStore;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "sigil-security-payments-"));
  const audit = new AuditService(new FileAuditStore(dataDir));
  const grimoire = new GrimoireService(
    new FileGrimoireStore(dataDir),
    Buffer.alloc(32, 1),
    audit
  );
  const memoryStore = new FileMemoryStore(dataDir);
  const paymentStore = new FilePaymentStore(dataDir);

  await grimoire.setPolicy({
    agent_id: "agent-demo-1",
    policy_id: "pol-demo",
    enabled: true,
    allowed_urls: ["http://localhost:4021/weather"],
    allowed_methods: ["GET"],
    allowed_asset: { caip2_chain_id: "casper:casper-test" },
    max_amount_per_call: "0.05",
    max_amount_per_period: "1.00",
    period_seconds: 86400,
    secret_scopes: ["x402:sign"],
    ...policyOverrides
  });

  return {
    audit,
    grimoire,
    memoryStore,
    payment: new PaymentService(grimoire, paymentStore, audit, options.challengeClient),
    paymentStore
  };
}

function captureTools(register: (server: McpServer) => void): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    registerTool(
      name: string,
      config: { inputSchema: Record<string, z.ZodTypeAny> },
      handler: (input: Record<string, unknown>) => Promise<CallToolResult>
    ) {
      tools.set(name, {
        inputSchema: config.inputSchema,
        handler
      });
    }
  } as unknown as McpServer;

  register(server);
  return tools;
}

async function callJsonTool<T = unknown>(
  tool: CapturedTool | undefined,
  input: Record<string, unknown>
): Promise<T> {
  const capturedTool = requireTool(tool);
  const parsed = validateToolInput(capturedTool, input);
  if (!parsed.success) {
    throw new Error(`Invalid test tool input: ${parsed.error.message}`);
  }

  return parseJsonToolResult(await capturedTool.handler(parsed.data));
}

function requireTool(tool: CapturedTool | undefined): CapturedTool {
  if (!tool) {
    throw new Error("Expected tool to be registered");
  }

  return tool;
}

function validateToolInput(tool: CapturedTool, input: Record<string, unknown>) {
  return z.object(tool.inputSchema).safeParse(input);
}

function parseJsonToolResult<T>(result: CallToolResult): T {
  const [content] = result.content;
  if (!content || content.type !== "text") {
    throw new Error(`Expected text tool result, received ${JSON.stringify(result)}`);
  }

  return JSON.parse(content.text) as T;
}
