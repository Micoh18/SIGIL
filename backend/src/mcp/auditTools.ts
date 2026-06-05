import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuditService } from "../audit/service.js";
import { jsonResult } from "./jsonResult.js";

export function registerAuditTools(server: McpServer, auditService: AuditService): void {
  server.registerTool(
    "audit.tail",
    {
      title: "Tail Audit Events",
      description:
        "Return recent Mr Mainspring audit events for memory, Grimoire, payment, and anchor activity.",
      inputSchema: {
        agent_id: z.string().min(1).optional(),
        event_type: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async (input) => jsonResult(await auditService.tail(input))
  );
}
