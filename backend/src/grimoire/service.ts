import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { canonicalizeJson, toJsonObject } from "../memory/canonical.js";
import { sha256Hex } from "../memory/hash.js";
import type {
  GrimoireStore,
  PolicyRecord,
  PolicySetInput,
  SecretMetadata,
  SecretPutInput,
  SecretRecord
} from "./types.js";

export class GrimoireService {
  constructor(
    private readonly store: GrimoireStore,
    private readonly masterKey: Buffer
  ) {}

  async putSecret(input: SecretPutInput): Promise<SecretMetadata> {
    const now = new Date().toISOString();
    const encrypted = encrypt(input.value, this.masterKey);
    const existing = await this.store.getSecretByName(input.agent_id, input.name);

    const record: SecretRecord = {
      id: existing?.id ?? createId("sec"),
      agent_id: input.agent_id,
      name: input.name,
      type: input.type,
      scopes: [...new Set(input.scopes)].sort(),
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      key_version: "local-v1",
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null
    };

    await this.store.saveSecret(record);
    return toSecretMetadata(record);
  }

  async listSecrets(agentId: string): Promise<SecretMetadata[]> {
    const secrets = await this.store.listSecrets(agentId);
    return secrets.filter((secret) => !secret.deleted_at).map(toSecretMetadata);
  }

  async setPolicy(input: PolicySetInput): Promise<PolicyRecord> {
    const now = new Date().toISOString();
    const existing = await this.store.getPolicy(input.agent_id, input.policy_id);
    const policyBody = {
      agent_id: input.agent_id,
      policy_id: input.policy_id,
      enabled: input.enabled ?? true,
      allowed_urls: input.allowed_urls,
      allowed_methods: input.allowed_methods.map((method) => method.toUpperCase()).sort(),
      allowed_asset: toJsonObject(input.allowed_asset, "allowed_asset"),
      max_amount_per_call: input.max_amount_per_call,
      max_amount_per_period: input.max_amount_per_period,
      period_seconds: input.period_seconds,
      secret_scopes: [...new Set(input.secret_scopes)].sort()
    };

    const record: PolicyRecord = {
      ...policyBody,
      policy_hash: sha256Hex(canonicalizeJson(policyBody)),
      current_period_spend: existing?.current_period_spend ?? "0",
      period_started_at: existing?.period_started_at ?? now,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };

    await this.store.savePolicy(record);
    return record;
  }

  async getPolicy(agentId: string, policyId: string): Promise<PolicyRecord | null> {
    return this.store.getPolicy(agentId, policyId);
  }
}

function encrypt(value: string, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

function toSecretMetadata(secret: SecretRecord): SecretMetadata {
  return {
    id: secret.id,
    agent_id: secret.agent_id,
    name: secret.name,
    type: secret.type,
    scopes: secret.scopes,
    created_at: secret.created_at,
    updated_at: secret.updated_at
  };
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
