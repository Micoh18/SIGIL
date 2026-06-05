import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PaymentService } from "../payments/service.js";
import { jsonResult } from "./jsonResult.js";

const nonEmptyStringSchema = z.string().trim().min(1);
const urlSchema = z.string().trim().url();
const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal amount");

export function registerPaymentTools(
  server: McpServer,
  paymentService: PaymentService
): void {
  server.registerTool(
    "payment.fetch",
    {
      title: "x402 Payment Fetch",
      description:
        "Create a durable x402 payment record after checking a Grimoire policy. When request_challenge is true, make the first x402 HTTP request and persist any 402 requirements without claiming Casper settlement.",
      inputSchema: {
        agent_id: nonEmptyStringSchema,
        policy_id: nonEmptyStringSchema,
        method: nonEmptyStringSchema.default("GET"),
        url: urlSchema,
        expected_amount: decimalAmountSchema.optional(),
        idempotency_key: nonEmptyStringSchema.optional(),
        request_challenge: z.boolean().optional().default(false)
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
        payment_id: nonEmptyStringSchema
      }
    },
    async ({ payment_id }) => jsonResult(await paymentService.receipt(payment_id))
  );
}

