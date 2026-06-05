import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
  grimoireService: GrimoireService
): void {
  server.registerTool(
    "grimoire.secret.put",
    {
      title: "Store Secret",
      description: "Encrypt and store a scoped SIGIL secret. The plaintext is never returned.",
      inputSchema: {
        agent_id: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        type: secretTypeSchema,
        value: nonEmptyStringSchema,
        scopes: z.array(nonEmptyStringSchema).min(1)
      }
    },
    async (input) => {
      const secret = await grimoireService.putSecret(input);

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
      description: "List SIGIL secret metadata for an agent without exposing secret values.",
      inputSchema: {
        agent_id: nonEmptyStringSchema
      }
    },
    async ({ agent_id }) => {
      const secrets = await grimoireService.listSecrets(agent_id);

      return jsonResult({
        agent_id,
        count: secrets.length,
        secrets
      });
    }
  );

  server.registerTool(
    "grimoire.policy.set",
    {
      title: "Set Policy",
      description: "Create or update a SIGIL spending/access policy commitment.",
      inputSchema: {
        agent_id: nonEmptyStringSchema,
        policy_id: nonEmptyStringSchema,
        enabled: z.boolean().optional(),
        allowed_urls: z.array(urlSchema).min(1),
        allowed_methods: z.array(nonEmptyStringSchema).min(1),
        allowed_asset: jsonObjectSchema,
        max_amount_per_call: decimalAmountSchema,
        max_amount_per_period: decimalAmountSchema,
        period_seconds: z.number().int().positive(),
        secret_scopes: z.array(nonEmptyStringSchema).default([])
      }
    },
    async (input) => {
      const policy = await grimoireService.setPolicy(input);

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
      description: "Read one SIGIL policy and current local spend metadata.",
      inputSchema: {
        agent_id: nonEmptyStringSchema,
        policy_id: nonEmptyStringSchema
      }
    },
    async ({ agent_id, policy_id }) => {
      const policy = await grimoireService.getPolicy(agent_id, policy_id);

      if (!policy) {
        return jsonResult({
          found: false,
          agent_id,
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
