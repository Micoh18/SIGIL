import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requestOptions = { timeout: 10_000 };

describe("MCP stdio server", () => {
  it("lists and executes core SIGIL tools end to end", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "sigil-mcp-stdio-"));
    const stderrChunks: Buffer[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(backendRoot, "src", "index.ts")
      ],
      cwd: backendRoot,
      env: {
        SIGIL_DATA_DIR: dataDir,
        SIGIL_MCP_NAME: "sigil-stdio-test",
        SIGIL_MCP_VERSION: "0.0.0-test"
      },
      stderr: "pipe"
    });
    transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    const client = new Client({
      name: "sigil-stdio-smoke-test",
      version: "0.1.0"
    });

    try {
      await client.connect(transport, requestOptions);

      const listedTools = await client.listTools(undefined, requestOptions);
      const toolNames = listedTools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual(
        expect.arrayContaining([
          "memory.write",
          "memory.verify",
          "grimoire.policy.set",
          "payment.fetch",
          "audit.tail"
        ])
      );

      const agentId = "agent-mcp-stdio-1";
      const policyId = "pol-mcp-stdio";
      const resourceUrl = "http://localhost:4021/weather";

      const writeResult = await callJsonTool<{
        memory_id: string;
        content_hash: string;
        anchor_status: string;
      }>(client, "memory.write", {
        agent_id: agentId,
        type: "observation",
        source: { kind: "mcp-stdio-test" },
        body: { note: "MCP stdio smoke test" },
        anchor: true
      });

      expect(writeResult.memory_id).toMatch(/^mem_/);
      expect(writeResult.content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(writeResult.anchor_status).toBe("pending");

      const verifyResult = await callJsonTool<{
        valid: boolean;
        memory_id: string;
        anchor_status: string;
      }>(client, "memory.verify", {
        agent_id: agentId,
        memory_id: writeResult.memory_id
      });

      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.memory_id).toBe(writeResult.memory_id);
      expect(verifyResult.anchor_status).toBe("pending");

      const policyResult = await callJsonTool<{
        status: string;
        policy: {
          agent_id: string;
          policy_id: string;
          allowed_methods: string[];
          policy_hash: string;
        };
      }>(client, "grimoire.policy.set", {
        agent_id: agentId,
        policy_id: policyId,
        allowed_urls: [resourceUrl],
        allowed_methods: ["get"],
        allowed_asset: { caip2_chain_id: "casper:casper-test" },
        max_amount_per_call: "0.05",
        max_amount_per_period: "1.00",
        period_seconds: 86_400,
        secret_scopes: ["x402:sign"]
      });

      expect(policyResult.status).toBe("stored");
      expect(policyResult.policy.agent_id).toBe(agentId);
      expect(policyResult.policy.policy_id).toBe(policyId);
      expect(policyResult.policy.allowed_methods).toEqual(["GET"]);
      expect(policyResult.policy.policy_hash).toMatch(/^[a-f0-9]{64}$/);

      const paymentResult = await callJsonTool<{
        allowed: boolean;
        payment_id: string;
        status: string;
        next_state: string;
        method: string;
        persisted: boolean;
      }>(client, "payment.fetch", {
        agent_id: agentId,
        policy_id: policyId,
        method: "GET",
        url: resourceUrl,
        expected_amount: "0.01",
        idempotency_key: "mcp-stdio-1"
      });

      expect(paymentResult.allowed).toBe(true);
      expect(paymentResult.payment_id).toMatch(/^pay_/);
      expect(paymentResult.status).toBe("policy_checked");
      expect(paymentResult.next_state).toBe("challenge_received");
      expect(paymentResult.method).toBe("GET");
      expect(paymentResult.persisted).toBe(true);

      const auditResult = await callJsonTool<{
        count: number;
        events: Array<{ event_type: string; agent_id: string | null }>;
      }>(client, "audit.tail", {
        agent_id: agentId,
        limit: 20
      });
      const eventTypes = auditResult.events.map((event) => event.event_type);

      expect(auditResult.count).toBeGreaterThanOrEqual(5);
      expect(eventTypes).toEqual(
        expect.arrayContaining([
          "memory.created",
          "memory.verify_succeeded",
          "policy.set",
          "policy.get",
          "payment.policy_approved"
        ])
      );
      expect(auditResult.events.every((event) => event.agent_id === agentId)).toBe(true);
    } catch (error) {
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (stderr) {
        throw new Error(`${String(error)}\n\nMCP server stderr:\n${stderr}`);
      }

      throw error;
    } finally {
      await client.close();
    }
  });
});

async function callJsonTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return parseJsonToolResult(await client.callTool({ name, arguments: args }, undefined, requestOptions));
}

function parseJsonToolResult<T>(result: ToolCallResult): T {
  if (!("content" in result)) {
    throw new Error(`Expected content result, received ${JSON.stringify(result)}`);
  }

  const [content] = result.content;
  if (!content || content.type !== "text") {
    throw new Error(`Expected text result, received ${JSON.stringify(result)}`);
  }

  return JSON.parse(content.text) as T;
}
