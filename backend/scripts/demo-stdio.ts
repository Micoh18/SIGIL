import { rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;
type DemoStep = {
  name: string;
  detail: string;
};

const backendRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(tmpdir(), "mr-mainspring-evaluator-stdio-demo");
const requestOptions = { timeout: 10_000 };
const agentId = "agent-evaluator-demo-1";
const memoryId = "mem_evaluator_stdio_demo";
const policyId = "pol_evaluator_weather";
const resourceUrl = "http://localhost:4021/weather";
const secretValue = "local-evaluator-demo-secret-do-not-use";

const requiredTools = [
  "memory.write",
  "memory.read",
  "memory.search",
  "memory.verify",
  "grimoire.secret.put",
  "grimoire.secret.list",
  "grimoire.policy.set",
  "grimoire.policy.get",
  "payment.fetch",
  "payment.receipt",
  "audit.tail"
];

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const stderrChunks: Buffer[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(backendRoot, "dist", "index.js")],
    cwd: backendRoot,
    env: {
      SIGIL_DATA_DIR: dataDir,
      SIGIL_MCP_NAME: "mr-mainspring-evaluator-demo",
      SIGIL_MCP_VERSION: "0.1.0-demo",
      GRIMOIRE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      CASPER_NETWORK_NAME: "casper-test",
      CASPER_CAIP2_CHAIN_ID: "casper:casper-test",
      X402_FACILITATOR_URL: "http://localhost:4022",
      X402_RESOURCE_DEMO_URL: resourceUrl
    },
    stderr: "pipe"
  });
  transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const client = new Client({
    name: "mr-mainspring-evaluator-demo-runner",
    version: "0.1.0"
  });
  const steps: DemoStep[] = [];

  try {
    await client.connect(transport, requestOptions);

    const listedTools = await client.listTools(undefined, requestOptions);
    const toolNames = listedTools.tools.map((tool) => tool.name);
    for (const tool of requiredTools) {
      assert(toolNames.includes(tool), `MCP tool not listed: ${tool}`);
    }
    steps.push({
      name: "tools/list",
      detail: `${requiredTools.length} required tools available`
    });

    const writeResult = await callJsonTool<{
      memory_id: string;
      content_hash: string;
      metadata_hash: string;
      anchor_status: string;
      created_at: string;
    }>(client, "memory.write", {
      agent_id: agentId,
      memory_id: memoryId,
      type: "observation",
      source: {
        kind: "evaluator-demo",
        url: resourceUrl
      },
      body: {
        summary: "Evaluator demo memory written over MCP stdio.",
        tags: ["stdio", "memory", "local"]
      },
      anchor: true
    });
    assert(writeResult.memory_id === memoryId, "memory.write returned an unexpected memory_id");
    assertHex64("content_hash", writeResult.content_hash);
    assertHex64("metadata_hash", writeResult.metadata_hash);
    assert(writeResult.anchor_status === "pending", "memory.write did not return pending anchor status");
    steps.push({
      name: "memory.write",
      detail: `memory_id=${writeResult.memory_id} anchor_status=${writeResult.anchor_status} content_hash=<64-hex>`
    });

    const readResult = await callJsonTool<{
      found: boolean;
      memory?: {
        memory_id: string;
        body: { summary?: string };
        casper_transaction_hash: string | null;
      };
    }>(client, "memory.read", {
      agent_id: agentId,
      memory_id: memoryId
    });
    assert(readResult.found === true, "memory.read did not find the written memory");
    assert(readResult.memory?.memory_id === memoryId, "memory.read returned the wrong memory");
    assert(
      readResult.memory.body.summary === "Evaluator demo memory written over MCP stdio.",
      "memory.read returned an unexpected body"
    );
    steps.push({
      name: "memory.read",
      detail: `found=true memory_id=${readResult.memory.memory_id}`
    });

    const searchResult = await callJsonTool<{
      count: number;
      results: Array<{ memory_id: string; anchor_status: string }>;
    }>(client, "memory.search", {
      agent_id: agentId,
      query: "Evaluator demo memory",
      limit: 5
    });
    assert(searchResult.count === 1, `memory.search expected 1 result, got ${searchResult.count}`);
    assert(searchResult.results[0]?.memory_id === memoryId, "memory.search did not return the demo memory");
    steps.push({
      name: "memory.search",
      detail: `query=\"Evaluator demo memory\" count=${searchResult.count}`
    });

    const verifyResult = await callJsonTool<{
      valid: boolean;
      memory_id: string;
      anchor_status: string;
      anchor_id: string | null;
      casper_transaction_hash: string | null;
      onchain_content_hash: string | null;
    }>(client, "memory.verify", {
      agent_id: agentId,
      memory_id: memoryId
    });
    assert(verifyResult.valid === true, "memory.verify did not return valid=true");
    assert(verifyResult.memory_id === memoryId, "memory.verify returned the wrong memory");
    assert(verifyResult.anchor_status === "pending", "memory.verify did not keep pending anchor status");
    assert(verifyResult.casper_transaction_hash === null, "demo must not claim a Casper transaction hash");
    assert(verifyResult.onchain_content_hash === null, "demo must not claim an on-chain content hash");
    steps.push({
      name: "memory.verify",
      detail:
        "valid=true anchor_status=pending casper_transaction_hash=null onchain_content_hash=null"
    });

    const secretPutResult = await callJsonTool<{
      status: string;
      secret: { id: string; name: string; scopes: string[] };
    }>(client, "grimoire.secret.put", {
      agent_id: agentId,
      name: "demo_x402_key",
      type: "x402_client_key_ref",
      value: secretValue,
      scopes: ["x402:sign"]
    });
    assert(secretPutResult.status === "stored", "grimoire.secret.put did not store the secret");
    assert(secretPutResult.secret.name === "demo_x402_key", "grimoire.secret.put returned wrong secret");
    assertNoSecretValue("grimoire.secret.put", secretPutResult);
    steps.push({
      name: "grimoire.secret.put",
      detail: `status=stored name=${secretPutResult.secret.name} value=<not returned>`
    });

    const secretListResult = await callJsonTool<{
      agent_id: string;
      count: number;
      secrets: Array<{ name: string; scopes: string[] }>;
    }>(client, "grimoire.secret.list", {
      agent_id: agentId
    });
    assert(secretListResult.count === 1, `grimoire.secret.list expected 1 secret, got ${secretListResult.count}`);
    assert(secretListResult.secrets[0]?.name === "demo_x402_key", "grimoire.secret.list returned wrong secret");
    assertNoSecretValue("grimoire.secret.list", secretListResult);
    steps.push({
      name: "grimoire.secret.list",
      detail: "count=1 value=<not returned>"
    });

    const policySetResult = await callJsonTool<{
      status: string;
      policy: {
        policy_id: string;
        allowed_methods: string[];
        policy_hash: string;
        current_period_spend: string;
      };
    }>(client, "grimoire.policy.set", {
      agent_id: agentId,
      policy_id: policyId,
      enabled: true,
      allowed_urls: [resourceUrl],
      allowed_methods: ["get"],
      allowed_asset: {
        caip2_chain_id: "casper:casper-test",
        asset_package: "demo-asset-package"
      },
      max_amount_per_call: "0.05",
      max_amount_per_period: "1.00",
      period_seconds: 86_400,
      secret_scopes: ["x402:sign"]
    });
    assert(policySetResult.status === "stored", "grimoire.policy.set did not store the policy");
    assert(policySetResult.policy.policy_id === policyId, "grimoire.policy.set returned wrong policy");
    assert(policySetResult.policy.allowed_methods.join(",") === "GET", "policy method was not normalized");
    assertHex64("policy_hash", policySetResult.policy.policy_hash);
    steps.push({
      name: "grimoire.policy.set",
      detail: `status=stored policy_id=${policySetResult.policy.policy_id} allowed_methods=GET policy_hash=<64-hex>`
    });

    const policyGetResult = await callJsonTool<{
      found: boolean;
      policy?: {
        policy_id: string;
        current_period_spend: string;
        policy_hash: string;
      };
    }>(client, "grimoire.policy.get", {
      agent_id: agentId,
      policy_id: policyId
    });
    assert(policyGetResult.found === true, "grimoire.policy.get did not find the policy");
    assert(policyGetResult.policy?.policy_id === policyId, "grimoire.policy.get returned wrong policy");
    steps.push({
      name: "grimoire.policy.get",
      detail: `found=true current_period_spend=${policyGetResult.policy.current_period_spend}`
    });

    const paymentFetchResult = await callJsonTool<{
      allowed: boolean;
      payment_id: string;
      status: string;
      next_state: string | null;
      settlement: string;
      persisted: boolean;
      settlement_blocker?: string;
    }>(client, "payment.fetch", {
      agent_id: agentId,
      policy_id: policyId,
      method: "GET",
      url: resourceUrl,
      expected_amount: "0.01",
      idempotency_key: "evaluator-demo-weather-001",
      request_challenge: false
    });
    assert(paymentFetchResult.allowed === true, "payment.fetch was denied");
    assert(paymentFetchResult.payment_id.startsWith("pay_"), "payment.fetch returned invalid payment_id");
    assert(paymentFetchResult.status === "policy_checked", "payment.fetch returned unexpected status");
    assert(paymentFetchResult.next_state === "challenge_received", "payment.fetch returned unexpected next_state");
    assert(paymentFetchResult.settlement === "not_started", "payment.fetch must stay pre-settlement");
    assert(paymentFetchResult.persisted === true, "payment.fetch did not persist the intent");
    steps.push({
      name: "payment.fetch",
      detail:
        "allowed=true status=policy_checked next_state=challenge_received settlement=not_started payment_id=<pay_...>"
    });

    const paymentReceiptResult = await callJsonTool<{
      found: boolean;
      payment_id: string;
      intent?: { status: string; signed_payload_hash: string | null };
      receipt?: unknown;
    }>(client, "payment.receipt", {
      payment_id: paymentFetchResult.payment_id
    });
    assert(paymentReceiptResult.found === true, "payment.receipt did not find the intent");
    assert(paymentReceiptResult.intent?.status === "policy_checked", "payment.receipt returned wrong intent status");
    assert(paymentReceiptResult.intent.signed_payload_hash === null, "demo must not claim a signed payload");
    assert(paymentReceiptResult.receipt === null, "demo must not claim a settlement receipt");
    steps.push({
      name: "payment.receipt",
      detail: "found=true intent_status=policy_checked signed_payload_hash=null receipt=null"
    });

    const auditResult = await callJsonTool<{
      count: number;
      events: Array<{ event_type: string; agent_id: string | null }>;
    }>(client, "audit.tail", {
      agent_id: agentId,
      limit: 20
    });
    const eventTypes = auditResult.events.map((event) => event.event_type);
    for (const eventType of [
      "memory.created",
      "memory.verify_succeeded",
      "secret.stored",
      "secret.listed",
      "policy.set",
      "policy.get",
      "payment.policy_approved"
    ]) {
      assert(eventTypes.includes(eventType), `audit.tail missing ${eventType}`);
    }
    assert(
      auditResult.events.every((event) => event.agent_id === agentId),
      "audit.tail returned events for a different agent"
    );
    steps.push({
      name: "audit.tail",
      detail: `count=${auditResult.count} events=${[...new Set(eventTypes)].sort().join(",")}`
    });

    printTranscript(steps);
  } catch (error) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    if (stderr) {
      throw new Error(`${errorMessage(error)}\n\nMCP server stderr:\n${stderr}`);
    }

    throw error;
  } finally {
    await client.close();
  }
}

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

function printTranscript(steps: DemoStep[]) {
  console.log("Mr Mainspring evaluator stdio demo");
  console.log(`data_dir=${dataDir}`);
  console.log("server=node dist/index.js");
  console.log("scope=local-only casper_transaction_hash=null x402_settlement=not_started");

  for (const step of steps) {
    console.log(`PASS ${step.name}: ${step.detail}`);
  }

  console.log("RESULT PASS");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertHex64(name: string, value: string) {
  assert(/^[a-f0-9]{64}$/.test(value), `${name} must be a 64-character lowercase hex string`);
}

function assertNoSecretValue(label: string, value: unknown) {
  assert(!JSON.stringify(value).includes(secretValue), `${label} returned the raw secret value`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
