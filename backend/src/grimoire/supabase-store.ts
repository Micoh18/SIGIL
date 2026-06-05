import { SupabaseRestClient } from "../storage/supabase-rest.js";
import type { GrimoireStore, PolicyRecord, SecretRecord } from "./types.js";

export class SupabaseGrimoireStore implements GrimoireStore {
  private readonly secretsTable: string;
  private readonly policiesTable: string;

  constructor(private readonly client: SupabaseRestClient) {
    this.secretsTable = client.table("secrets");
    this.policiesTable = client.table("policies");
  }

  async saveSecret(secret: SecretRecord): Promise<void> {
    await this.client.upsert(
      this.secretsTable,
      {
        id: secret.id,
        agent_id: secret.agent_id,
        name: secret.name,
        created_at: secret.created_at,
        updated_at: secret.updated_at,
        deleted_at: secret.deleted_at,
        record: secret
      },
      "id"
    );
  }

  async getSecretByName(agentId: string, name: string): Promise<SecretRecord | null> {
    const records = await this.client.selectRecords<SecretRecord>(this.secretsTable, {
      filters: { agent_id: agentId, name },
      order: { column: "created_at" }
    });

    return records.find((secret) => !secret.deleted_at) ?? null;
  }

  async listSecrets(agentId: string): Promise<SecretRecord[]> {
    return this.client.selectRecords<SecretRecord>(this.secretsTable, {
      filters: { agent_id: agentId },
      order: { column: "created_at" }
    });
  }

  async savePolicy(policy: PolicyRecord): Promise<void> {
    await this.client.upsert(
      this.policiesTable,
      {
        agent_id: policy.agent_id,
        policy_id: policy.policy_id,
        created_at: policy.created_at,
        updated_at: policy.updated_at,
        record: policy
      },
      "agent_id,policy_id"
    );
  }

  async getPolicy(agentId: string, policyId: string): Promise<PolicyRecord | null> {
    const [record] = await this.client.selectRecords<PolicyRecord>(this.policiesTable, {
      filters: { agent_id: agentId, policy_id: policyId },
      limit: 1
    });

    return record ?? null;
  }
}
