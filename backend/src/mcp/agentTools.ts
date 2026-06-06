import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentIdentity } from "../agent/identity.js";
import { jsonResult } from "./jsonResult.js";

export function registerAgentTools(server: McpServer, identity: AgentIdentity): void {
  server.registerTool(
    "agent.whoami",
    {
      title: "Current Agent Identity",
      description: "Return the local default Mr Mainspring agent identity for this installation.",
      inputSchema: {}
    },
    async () =>
      jsonResult({
        agent_id: identity.agent_id,
        created_at: identity.created_at,
        updated_at: identity.updated_at
      })
  );
}
