import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentIdentityContext } from "../agent/identity.js";
import { resolveAgentId } from "../agent/identity.js";
import type { AuditService } from "../audit/service.js";
import { jsonResult } from "./jsonResult.js";

export function registerAuditTools(
  server: McpServer,
  auditService: AuditService,
  identity?: AgentIdentityContext
): void {
  server.registerTool(
    "audit.tail",
    {
      title: "Tail Audit Events",
      description:
        "Return recent Mr Mainspring audit events for memory, Grimoire, payment, and anchor activity.",
      inputSchema: {
        agent_id: z.string().min(1).optional(),
        event_type: z.string().min(1).optional(),
        all_agents: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ agent_id, event_type, all_agents, limit }) =>
      jsonResult(
        await auditService.tail({
          agent_id:
            !all_agents && identity ? resolveAgentId(agent_id, identity) : agent_id,
          event_type,
          limit
        })
      )
  );
}
