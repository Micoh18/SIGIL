import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentIdentity = {
  schema_version: "mainspring.agent-identity.v1";
  agent_id: string;
  created_at: string;
  updated_at: string;
};

export type AgentIdentityContext = {
  defaultAgentId: string;
};

export function agentIdentityPath(dataDir: string): string {
  return join(dataDir, "agent.json");
}

export function ensureLocalAgentIdentity(dataDir: string): AgentIdentity {
  const path = agentIdentityPath(dataDir);
  const existing = readLocalAgentIdentity(dataDir);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const identity: AgentIdentity = {
    schema_version: "mainspring.agent-identity.v1",
    agent_id: createAgentId(),
    created_at: now,
    updated_at: now
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  return identity;
}

export function readLocalAgentIdentity(dataDir: string): AgentIdentity | null {
  const path = agentIdentityPath(dataDir);
  if (!existsSync(path)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return normalizeAgentIdentity(parsed);
}

export function resolveAgentId(
  explicitAgentId: string | undefined,
  identity?: AgentIdentityContext
): string {
  const normalized = explicitAgentId?.trim();
  if (normalized) {
    return normalized;
  }

  if (identity?.defaultAgentId) {
    return identity.defaultAgentId;
  }

  throw new Error("agent_id is required");
}

function normalizeAgentIdentity(parsed: unknown): AgentIdentity {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid agent identity file");
  }

  const record = parsed as Record<string, unknown>;
  const agentId = typeof record.agent_id === "string" ? record.agent_id.trim() : "";
  const createdAt =
    typeof record.created_at === "string" && record.created_at.trim()
      ? record.created_at
      : new Date().toISOString();
  const updatedAt =
    typeof record.updated_at === "string" && record.updated_at.trim()
      ? record.updated_at
      : createdAt;

  if (!agentId) {
    throw new Error("Invalid agent identity file: agent_id is required");
  }

  return {
    schema_version: "mainspring.agent-identity.v1",
    agent_id: agentId,
    created_at: createdAt,
    updated_at: updatedAt
  };
}

function createAgentId(): string {
  return `agent_${randomUUID().replaceAll("-", "")}`;
}
