import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PaymentService } from "../payments/service.js";
import { jsonResult } from "./jsonResult.js";

export function registerPaymentTools(
  server: McpServer,
  paymentService: PaymentService
): void {
  server.registerTool(
    "payment.fetch",
    {
      title: "Preflight x402 Fetch",
      description:
        "Check a Grimoire policy before an x402 paid fetch. Casper facilitator settlement is added in the next integration step.",
      inputSchema: {
        agent_id: z.string().min(1),
        policy_id: z.string().min(1),
        method: z.string().min(1).default("GET"),
        url: z.string().url(),
        expected_amount: z.string().min(1).optional()
      }
    },
    async (input) => {
      const result = await paymentService.preflightFetch(input);
      return jsonResult(result);
    }
  );
}

