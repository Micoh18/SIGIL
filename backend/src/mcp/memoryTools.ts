import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentIdentityContext } from "../agent/identity.js";
import { resolveAgentId } from "../agent/identity.js";
import { jsonResult } from "./jsonResult.js";
import type { MemoryService } from "../memory/service.js";
import { memoryTypes } from "../memory/types.js";

const memoryTypeSchema = z.enum(memoryTypes);

const jsonBodySchema = z.record(z.string(), z.unknown());

export function registerMemoryTools(
  server: McpServer,
  memoryService: MemoryService,
  identity?: AgentIdentityContext
): void {
  const agentIdSchema = identity ? z.string().min(1).optional() : z.string().min(1);

  server.registerTool(
    "memory.write",
    {
      title: "Write Memory",
      description:
        "Store a Mr Mainspring agent memory and compute its deterministic content hash.",
      inputSchema: {
        agent_id: agentIdSchema,
        type: memoryTypeSchema,
        body: jsonBodySchema,
        source: jsonBodySchema.optional(),
        anchor: z.boolean().optional(),
        memory_id: z.string().min(1).optional(),
        prev_anchor_hash: z.string().min(1).nullable().optional()
      }
    },
    async (input) => {
      const memory = await memoryService.write({
        ...input,
        agent_id: resolveAgentId(input.agent_id, identity)
      });

      return jsonResult({
        memory_id: memory.memory_id,
        content_hash: memory.content_hash,
        metadata_hash: memory.metadata_hash,
        anchor_status: memory.anchor_status,
        created_at: memory.created_at
      });
    }
  );

  server.registerTool(
    "memory.read",
    {
      title: "Read Memory",
      description: "Read one stored Mr Mainspring memory by agent and memory id.",
      inputSchema: {
        agent_id: agentIdSchema,
        memory_id: z.string().min(1)
      }
    },
    async ({ agent_id, memory_id }) => {
      const resolvedAgentId = resolveAgentId(agent_id, identity);
      const memory = await memoryService.read(resolvedAgentId, memory_id);

      if (!memory) {
        return jsonResult({
          found: false,
          agent_id: resolvedAgentId,
          memory_id
        });
      }

      return jsonResult({
        found: true,
        memory
      });
    }
  );

  server.registerTool(
    "memory.search",
    {
      title: "Search Memory",
      description: "Search stored Mr Mainspring memories for an agent.",
      inputSchema: {
        agent_id: agentIdSchema,
        query: z.string().default(""),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ agent_id, query, limit }) => {
      const result = await memoryService.search(resolveAgentId(agent_id, identity), query, limit);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "memory.verify",
    {
      title: "Verify Memory",
      description: "Recompute a local memory hash and report whether it still matches the stored hash.",
      inputSchema: {
        agent_id: agentIdSchema,
        memory_id: z.string().min(1)
      }
    },
    async ({ agent_id, memory_id }) => {
      const verification = await memoryService.verify(resolveAgentId(agent_id, identity), memory_id);
      return jsonResult(verification);
    }
  );
}
