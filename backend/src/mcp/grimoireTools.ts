import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentIdentityContext } from "../agent/identity.js";
import { resolveAgentId } from "../agent/identity.js";
import type { GrimoireService } from "../grimoire/service.js";
import { jsonResult } from "./jsonResult.js";

const secretTypeSchema = z.enum([
  "casper_private_key_ref",
  "x402_client_key_ref",
  "api_key",
  "webhook_secret"
]);

const jsonObjectSchema = z.record(z.string(), z.unknown());
const nonEmptyStringSchema = z.string().trim().min(1);
const urlSchema = z.string().trim().url();
const decimalAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal amount");

export function registerGrimoireTools(
  server: McpServer,
  grimoireService: GrimoireService,
  identity?: AgentIdentityContext
): void {
  const agentIdSchema = identity ? nonEmptyStringSchema.optional() : nonEmptyStringSchema;

  server.registerTool(
    "grimoire.secret.put",
    {
      title: "Store Secret",
      description:
        "Encrypt and store a scoped Mr Mainspring secret or non-sensitive secret reference. Use this when the user says to use, configure, register, or remember their configured wallet for payments. The plaintext is never returned. When the user refers to the wallet configured by `mainspring wallet setup`, prefer a non-sensitive reference value such as `configured-via-mainspring-wallet-setup`; do not ask for or store raw private key contents.",
      inputSchema: {
        agent_id: agentIdSchema,
        name: nonEmptyStringSchema,
        type: secretTypeSchema,
        value: nonEmptyStringSchema.describe(
          "Secret value or reference. For an already configured Casper wallet, use a non-sensitive reference instead of a PEM path or private key when possible."
        ),
        scopes: z.array(nonEmptyStringSchema).min(1)
      }
    },
    async (input) => {
      const secret = await grimoireService.putSecret({
        ...input,
        agent_id: resolveAgentId(input.agent_id, identity)
      });

      return jsonResult({
        status: "stored",
        secret
      });
    }
  );

  server.registerTool(
    "grimoire.secret.list",
    {
      title: "List Secrets",
      description:
        "List Mr Mainspring secret metadata for an agent without exposing secret values. Use this when the user asks which signers or secrets are available, not when they ask to configure a wallet.",
      inputSchema: {
        agent_id: agentIdSchema
      }
    },
    async ({ agent_id }) => {
      const resolvedAgentId = resolveAgentId(agent_id, identity);
      const secrets = await grimoireService.listSecrets(resolvedAgentId);

      return jsonResult({
        agent_id: resolvedAgentId,
        count: secrets.length,
        secrets
      });
    }
  );

  server.registerTool(
    "grimoire.policy.set",
    {
      title: "Set Policy",
      description:
        "Create or update a Mr Mainspring spending/access policy commitment. Use GET for x402 paid resources that return 402 PAYMENT-REQUIRED. Use POST only when the target is explicitly a POST action or wrapper endpoint.",
      inputSchema: {
        agent_id: agentIdSchema,
        policy_id: nonEmptyStringSchema,
        enabled: z.boolean().optional(),
        allowed_urls: z.array(urlSchema).min(1),
        allowed_methods: z
          .array(nonEmptyStringSchema)
          .min(1)
          .default(["GET"])
          .describe("HTTP methods allowed by the policy. Defaults to GET for x402 paid resources. Use POST only for explicit POST action or wrapper endpoints."),
        allowed_asset: jsonObjectSchema,
        max_amount_per_call: decimalAmountSchema,
        max_amount_per_period: decimalAmountSchema,
        period_seconds: z.number().int().positive(),
        secret_scopes: z.array(nonEmptyStringSchema).default([])
      }
    },
    async (input) => {
      const policy = await grimoireService.setPolicy({
        ...input,
        agent_id: resolveAgentId(input.agent_id, identity)
      });

      return jsonResult({
        status: "stored",
        policy
      });
    }
  );

  server.registerTool(
    "grimoire.policy.get",
    {
      title: "Get Policy",
      description: "Read one Mr Mainspring policy and current local spend metadata.",
      inputSchema: {
        agent_id: agentIdSchema,
        policy_id: nonEmptyStringSchema
      }
    },
    async ({ agent_id, policy_id }) => {
      const resolvedAgentId = resolveAgentId(agent_id, identity);
      const policy = await grimoireService.getPolicy(resolvedAgentId, policy_id);

      if (!policy) {
        return jsonResult({
          found: false,
          agent_id: resolvedAgentId,
          policy_id
        });
      }

      return jsonResult({
        found: true,
        policy
      });
    }
  );
}
