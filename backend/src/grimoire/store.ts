import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GrimoireStore, PolicyRecord, SecretRecord } from "./types.js";

type GrimoireStoreFile = {
  schema_version: "sigil.grimoire-store.v1";
  secrets: SecretRecord[];
  policies: PolicyRecord[];
};

export class FileGrimoireStore implements GrimoireStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "grimoire.json");
  }

  async saveSecret(secret: SecretRecord): Promise<void> {
    const data = await this.load();
    const existingIndex = data.secrets.findIndex((item) => item.id === secret.id);

    if (existingIndex >= 0) {
      data.secrets[existingIndex] = secret;
    } else {
      data.secrets.push(secret);
    }

    await this.persist(data);
  }

  async getSecretByName(agentId: string, name: string): Promise<SecretRecord | null> {
    const data = await this.load();

    return (
      data.secrets.find(
        (secret) => secret.agent_id === agentId && secret.name === name && !secret.deleted_at
      ) ?? null
    );
  }

  async listSecrets(agentId: string): Promise<SecretRecord[]> {
    const data = await this.load();
    return data.secrets.filter((secret) => secret.agent_id === agentId);
  }

  async savePolicy(policy: PolicyRecord): Promise<void> {
    const data = await this.load();
    const existingIndex = data.policies.findIndex(
      (item) => item.agent_id === policy.agent_id && item.policy_id === policy.policy_id
    );

    if (existingIndex >= 0) {
      data.policies[existingIndex] = policy;
    } else {
      data.policies.push(policy);
    }

    await this.persist(data);
  }

  async getPolicy(agentId: string, policyId: string): Promise<PolicyRecord | null> {
    const data = await this.load();

    return (
      data.policies.find(
        (policy) => policy.agent_id === agentId && policy.policy_id === policyId
      ) ?? null
    );
  }

  private async load(): Promise<GrimoireStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as GrimoireStoreFile;

      return {
        schema_version: "sigil.grimoire-store.v1",
        secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [],
        policies: Array.isArray(parsed.policies) ? parsed.policies : []
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyStore();
      }

      throw error;
    }
  }

  private async persist(data: GrimoireStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function emptyStore(): GrimoireStoreFile {
  return {
    schema_version: "sigil.grimoire-store.v1",
    secrets: [],
    policies: []
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

