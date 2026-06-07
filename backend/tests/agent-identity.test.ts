import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  agentIdentityPath,
  ensureLocalAgentIdentity
} from "../src/agent/identity.js";
import { registerMemoryTools } from "../src/mcp/memoryTools.js";
import { MemoryService } from "../src/memory/service.js";
import { FileMemoryStore } from "../src/memory/store.js";

type CapturedTool = {
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

describe("local agent identity", () => {
  it("creates one stable local agent id in the data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mainspring-agent-id-"));

    const first = ensureLocalAgentIdentity(dataDir);
    const second = ensureLocalAgentIdentity(dataDir);
    const raw = JSON.parse(await readFile(agentIdentityPath(dataDir), "utf8"));

    expect(first.agent_id).toMatch(/^agent_[a-f0-9]{32}$/);
    expect(second.agent_id).toBe(first.agent_id);
    expect(raw.agent_id).toBe(first.agent_id);
  });

  it("uses the local agent id by default when MCP tools omit agent_id", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mainspring-agent-tools-"));
    const identity = ensureLocalAgentIdentity(dataDir);
    const memory = new MemoryService(new FileMemoryStore(dataDir));
    const tools = captureTools((server) =>
      registerMemoryTools(server, memory, { defaultAgentId: identity.agent_id })
    );

    const write = await callJsonTool<{ memory_id: string }>(tools.get("memory.write"), {
      type: "observation",
      body: { note: "default local agent" }
    });
    const search = await callJsonTool<{
      agent_id: string;
      count: number;
      results: Array<{ memory_id: string }>;
    }>(tools.get("memory.search"), {
      query: "default local agent"
    });

    expect(search.agent_id).toBe(identity.agent_id);
    expect(search.count).toBe(1);
    expect(search.results[0]?.memory_id).toBe(write.memory_id);
  });

  it("verifies a remembered preference by query when the memory id is not provided", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "mainspring-agent-memory-query-"));
    const identity = ensureLocalAgentIdentity(dataDir);
    const memory = new MemoryService(new FileMemoryStore(dataDir));
    const tools = captureTools((server) =>
      registerMemoryTools(server, memory, { defaultAgentId: identity.agent_id })
    );

    const write = await callJsonTool<{ memory_id: string }>(tools.get("memory.write"), {
      type: "preference",
      body: {
        preference: "Use plain English and only make claims that can be proven."
      }
    });
    const verify = await callJsonTool<{
      valid: boolean;
      memory_id: string;
      search_count: number;
    }>(tools.get("memory.verify"), {
      query: "plain English proven claims"
    });

    expect(verify.valid).toBe(true);
    expect(verify.memory_id).toBe(write.memory_id);
    expect(verify.search_count).toBe(1);
  });
});

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

async function callJsonTool<T>(
  tool: CapturedTool | undefined,
  input: Record<string, unknown>
): Promise<T> {
  if (!tool) {
    throw new Error("Expected tool to be registered");
  }

  const parsed = z.object(tool.inputSchema).safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid test tool input: ${parsed.error.message}`);
  }

  const [content] = (await tool.handler(parsed.data)).content;
  if (!content || content.type !== "text") {
    throw new Error("Expected text tool result");
  }

  return JSON.parse(content.text) as T;
}
