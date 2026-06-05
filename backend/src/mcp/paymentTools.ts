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
        "Create a durable x402 payment preflight record after checking a Grimoire policy. Real Casper settlement is not claimed until a facilitator client is wired and verified.",
      inputSchema: {
        agent_id: z.string().min(1),
        policy_id: z.string().min(1),
        method: z.string().min(1).default("GET"),
        url: z.string().url(),
        expected_amount: z.string().min(1).optional(),
        idempotency_key: z.string().min(1).optional()
      }
    },
    async (input) => {
      const result = await paymentService.fetch(input);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "payment.receipt",
    {
      title: "Read Payment Receipt",
      description:
        "Return the persisted SIGIL payment intent and receipt metadata. Signed payloads and secrets are never returned.",
      inputSchema: {
        payment_id: z.string().min(1)
      }
    },
    async ({ payment_id }) => jsonResult(await paymentService.receipt(payment_id))
  );
}

