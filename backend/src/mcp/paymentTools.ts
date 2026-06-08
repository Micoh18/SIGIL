import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentIdentityContext } from "../agent/identity.js";
import { resolveAgentId } from "../agent/identity.js";
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
  paymentService: PaymentService,
  identity?: AgentIdentityContext
): void {
  const agentIdSchema = identity ? nonEmptyStringSchema.optional() : nonEmptyStringSchema;

  server.registerTool(
    "payment.fetch",
    {
      title: "x402 Payment Fetch",
      description:
        "Create a durable x402 payment record after checking a Grimoire policy. Defaults to GET because x402 paid resources normally return 402 PAYMENT-REQUIRED on an initial GET, then settle and retry the same GET with PAYMENT-SIGNATURE. Use POST only when the target is explicitly a POST action or wrapper endpoint. Use the same idempotency_key when checking retry or duplicate-charge protection. With request_challenge=true, make the first x402 HTTP request, persist and approve 402 requirements, then either persist a disabled/failed receipt or, when real settlement is configured, retry the paid resource with PAYMENT-SIGNATURE and return verified settlement without exposing signed payloads.",
      inputSchema: {
        agent_id: agentIdSchema,
        policy_id: nonEmptyStringSchema,
        method: nonEmptyStringSchema.default("GET"),
        url: urlSchema,
        expected_amount: decimalAmountSchema.optional(),
        idempotency_key: nonEmptyStringSchema.optional(),
        request_challenge: z.boolean().optional().default(false)
      }
    },
    async (input) => {
      const result = await paymentService.fetch({
        ...input,
        agent_id: resolveAgentId(input.agent_id, identity)
      });
      return jsonResult(result);
    }
  );

  server.registerTool(
    "payment.receipt",
    {
      title: "Read Payment Receipt",
      description:
        "Return the persisted Mr Mainspring payment intent and receipt metadata. Signed payloads and secrets are never returned.",
      inputSchema: {
        payment_id: nonEmptyStringSchema
      }
    },
    async ({ payment_id }) => jsonResult(await paymentService.receipt(payment_id))
  );
}

export const paymentToolMetadata = {
  list: [
    {
      name: "payment.fetch",
      title: "x402 Payment Fetch",
      description: "Create or continue a payment flow for a protected resource, enforcing policy first."
    },
    {
      name: "payment.receipt",
      title: "Read Payment Receipt",
      description: "Return persisted payment intent and receipt metadata without exposing signed artifacts."
    }
  ] as const
};

