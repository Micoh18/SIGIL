-- Mr Mainspring optional Supabase persistence.
--
-- Run this in the Supabase SQL editor before setting:
--   SIGIL_STORAGE_BACKEND=supabase
--   SUPABASE_URL=...
--   SUPABASE_SERVICE_ROLE_KEY=...
--
-- The backend keeps current domain records in JSONB so Supabase can be adopted
-- without rewriting the MCP service contracts. Indexed scalar columns support
-- the lookups currently required by the store interfaces.

create table if not exists public.sigil_memories (
  agent_id text not null,
  memory_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null,
  primary key (agent_id, memory_id)
);

create index if not exists sigil_memories_agent_created_idx
  on public.sigil_memories (agent_id, created_at desc);

create table if not exists public.sigil_secrets (
  id text primary key,
  agent_id text not null,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz null,
  record jsonb not null
);

create index if not exists sigil_secrets_agent_name_idx
  on public.sigil_secrets (agent_id, name);

create table if not exists public.sigil_policies (
  agent_id text not null,
  policy_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null,
  primary key (agent_id, policy_id)
);

create table if not exists public.sigil_payment_intents (
  id text primary key,
  agent_id text not null,
  idempotency_key text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  record jsonb not null
);

create index if not exists sigil_payment_intents_idempotency_idx
  on public.sigil_payment_intents (agent_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.sigil_payment_receipts (
  id text primary key,
  payment_id text not null,
  created_at timestamptz not null,
  record jsonb not null
);

create index if not exists sigil_payment_receipts_payment_idx
  on public.sigil_payment_receipts (payment_id, created_at desc);

create table if not exists public.sigil_audit_events (
  id text primary key,
  agent_id text null,
  event_type text not null,
  created_at timestamptz not null,
  record jsonb not null
);

create index if not exists sigil_audit_events_created_idx
  on public.sigil_audit_events (created_at asc);

create index if not exists sigil_audit_events_agent_created_idx
  on public.sigil_audit_events (agent_id, created_at desc);
