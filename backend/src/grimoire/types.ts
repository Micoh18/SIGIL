import type { JsonObject } from "../memory/types.js";

export type SecretType =
  | "casper_private_key_ref"
  | "x402_client_key_ref"
  | "api_key"
  | "webhook_secret";

export type SecretPutInput = {
  agent_id: string;
  name: string;
  type: SecretType;
  value: string;
  scopes: string[];
};

export type SecretRecord = {
  id: string;
  agent_id: string;
  name: string;
  type: SecretType;
  scopes: string[];
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  key_version: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type SecretMetadata = Pick<
  SecretRecord,
  "id" | "agent_id" | "name" | "type" | "scopes" | "created_at" | "updated_at"
>;

export type PolicySetInput = {
  agent_id: string;
  policy_id: string;
  enabled?: boolean;
  allowed_urls: string[];
  allowed_methods: string[];
  allowed_asset: unknown;
  max_amount_per_call: string;
  max_amount_per_period: string;
  period_seconds: number;
  secret_scopes: string[];
};

export type PolicyRecord = {
  agent_id: string;
  policy_id: string;
  enabled: boolean;
  allowed_urls: string[];
  allowed_methods: string[];
  allowed_asset: JsonObject;
  max_amount_per_call: string;
  max_amount_per_period: string;
  period_seconds: number;
  secret_scopes: string[];
  policy_hash: string;
  current_period_spend: string;
  period_started_at: string;
  created_at: string;
  updated_at: string;
};

export type GrimoireStore = {
  saveSecret(secret: SecretRecord): Promise<void>;
  getSecretByName(agentId: string, name: string): Promise<SecretRecord | null>;
  listSecrets(agentId: string): Promise<SecretRecord[]>;
  savePolicy(policy: PolicyRecord): Promise<void>;
  getPolicy(agentId: string, policyId: string): Promise<PolicyRecord | null>;
};
