import { join } from "node:path";
import { JsonFileStore } from "../storage/json-file-store.js";
import type { GrimoireStore, PolicyRecord, SecretRecord } from "./types.js";

type GrimoireStoreFile = {
  schema_version: "sigil.grimoire-store.v1";
  secrets: SecretRecord[];
  policies: PolicyRecord[];
};

export class FileGrimoireStore implements GrimoireStore {
  private readonly store: JsonFileStore<GrimoireStoreFile>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore({
      filePath: join(dataDir, "grimoire.json"),
      empty: emptyStore,
      normalize: normalizeStore
    });
  }

  async saveSecret(secret: SecretRecord): Promise<void> {
    await this.store.update((data) => {
      const existingIndex = data.secrets.findIndex((item) => item.id === secret.id);

      if (existingIndex >= 0) {
        data.secrets[existingIndex] = secret;
      } else {
        data.secrets.push(secret);
      }
    });
  }

  async getSecretByName(agentId: string, name: string): Promise<SecretRecord | null> {
    const data = await this.store.read();

    return (
      data.secrets.find(
        (secret) => secret.agent_id === agentId && secret.name === name && !secret.deleted_at
      ) ?? null
    );
  }

  async listSecrets(agentId: string): Promise<SecretRecord[]> {
    const data = await this.store.read();
    return data.secrets.filter((secret) => secret.agent_id === agentId);
  }

  async savePolicy(policy: PolicyRecord): Promise<void> {
    await this.store.update((data) => {
      const existingIndex = data.policies.findIndex(
        (item) => item.agent_id === policy.agent_id && item.policy_id === policy.policy_id
      );

      if (existingIndex >= 0) {
        data.policies[existingIndex] = policy;
      } else {
        data.policies.push(policy);
      }
    });
  }

  async getPolicy(agentId: string, policyId: string): Promise<PolicyRecord | null> {
    const data = await this.store.read();

    return (
      data.policies.find(
        (policy) => policy.agent_id === agentId && policy.policy_id === policyId
      ) ?? null
    );
  }
}

function emptyStore(): GrimoireStoreFile {
  return {
    schema_version: "sigil.grimoire-store.v1",
    secrets: [],
    policies: []
  };
}

function normalizeStore(parsed: unknown): GrimoireStoreFile {
  const data = asStoreObject(parsed);

  return {
    schema_version: "sigil.grimoire-store.v1",
    secrets: Array.isArray(data.secrets) ? (data.secrets as SecretRecord[]) : [],
    policies: Array.isArray(data.policies) ? (data.policies as PolicyRecord[]) : []
  };
}

function asStoreObject(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
