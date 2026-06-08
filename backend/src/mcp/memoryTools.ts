import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentIdentityContext } from "../agent/identity.js";
import { resolveAgentId } from "../agent/identity.js";
import { jsonResult } from "./jsonResult.js";
import type { MemoryService } from "../memory/service.js";
import { memoryTypes } from "../memory/types.js";

const memoryTypeSchema = z.enum(memoryTypes);

const jsonBodySchema = z.record(z.string(), z.unknown());
const jsonBodyOrTextSchema = z.union([jsonBodySchema, z.string().trim().min(1)]);

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
        "Proactively store a durable Mr Mainspring agent memory when the user shares a project preference, decision, or fact worth remembering. If the user says what to remember for this project, call this tool even when they do not say 'save'. Use type=preference for durable user preferences. Compute its deterministic content hash. Casper anchoring is optional; only set anchor=true when the user asks for proof, on-chain anchoring, or Casper verification.",
      inputSchema: {
        agent_id: agentIdSchema,
        type: memoryTypeSchema,
        body: jsonBodyOrTextSchema.describe(
          "Memory content. Prefer a JSON object; a plain text note is accepted and stored as { note }."
        ),
        source: jsonBodyOrTextSchema
          .optional()
          .describe(
            "Where the memory came from. Prefer a JSON object; a plain text source note is accepted and stored as { note }."
          ),
        anchor: z
          .boolean()
          .optional()
          .describe(
            "Request Casper/on-chain proof. Omit or false for normal durable memory unless the user explicitly asks for proof or anchoring."
          ),
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
      description:
        "Search stored Mr Mainspring memories for an agent. Use this when the user asks what was remembered or asks about a prior preference and you do not already have the memory id.",
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
      description:
        "Use when the user asks whether a stored memory can be trusted, verified, intact, or proven. Recompute a local memory hash and report whether it still matches the stored hash. If you do not have the memory id, provide a natural-language query and this tool will verify the best matching memory.",
      inputSchema: {
        agent_id: agentIdSchema,
        memory_id: z.string().min(1).optional(),
        query: z.string().min(1).optional()
      }
    },
    async ({ agent_id, memory_id, query }) => {
      const resolvedAgentId = resolveAgentId(agent_id, identity);

      if (!memory_id && query) {
        const search = await memoryService.search(resolvedAgentId, query, 1);
        const match = search.results[0];

        if (!match) {
          return jsonResult({
            valid: false,
            reason: "memory_not_found",
            agent_id: resolvedAgentId,
            query,
            search_count: 0
          });
        }

        const verification = await memoryService.verify(resolvedAgentId, match.memory_id);
        return jsonResult({
          ...verification,
          query,
          search_count: search.count
        });
      }

      if (!memory_id) {
        return jsonResult({
          valid: false,
          reason: "memory_id_or_query_required",
          agent_id: resolvedAgentId
        });
      }

      const verification = await memoryService.verify(resolvedAgentId, memory_id);
      return jsonResult(verification);
    }
  );
}

export const memoryToolMetadata = {
  list: [
    {
      name: "memory.write",
      title: "Write Memory",
      description:
        "Store durable agent memories (preference, decision, fact, etc.) with deterministic hashing and optional anchoring metadata."
    },
    {
      name: "memory.read",
      title: "Read Memory",
      description: "Read one stored memory by memory_id."
    },
    {
      name: "memory.search",
      title: "Search Memory",
      description: "Search memories for the current agent."
    },
    {
      name: "memory.verify",
      title: "Verify Memory",
      description: "Recompute integrity and report whether a memory still matches its recorded hash."
    }
  ] as const
};
