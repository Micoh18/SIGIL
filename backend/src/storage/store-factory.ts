import { SupabaseAuditStore } from "../audit/supabase-store.js";
import { FileAuditStore } from "../audit/store.js";
import type { AuditStore } from "../audit/types.js";
import type { SigilConfig } from "../config.js";
import { SupabaseGrimoireStore } from "../grimoire/supabase-store.js";
import { FileGrimoireStore } from "../grimoire/store.js";
import type { GrimoireStore } from "../grimoire/types.js";
import { SupabaseMemoryStore } from "../memory/supabase-store.js";
import { FileMemoryStore } from "../memory/store.js";
import type { MemoryStore } from "../memory/types.js";
import { SupabasePaymentStore } from "../payments/supabase-store.js";
import { FilePaymentStore } from "../payments/store.js";
import type { PaymentStore } from "../payments/types.js";
import { SupabaseRestClient } from "./supabase-rest.js";

export type BackendStores = {
  audit: AuditStore;
  grimoire: GrimoireStore;
  memory: MemoryStore;
  payments: PaymentStore;
};

export function createBackendStores(config: SigilConfig): BackendStores {
  if (config.storage.backend === "supabase") {
    const client = new SupabaseRestClient(config.storage.supabase);

    return {
      audit: new SupabaseAuditStore(client),
      grimoire: new SupabaseGrimoireStore(client),
      memory: new SupabaseMemoryStore(client),
      payments: new SupabasePaymentStore(client)
    };
  }

  return {
    audit: new FileAuditStore(config.dataDir),
    grimoire: new FileGrimoireStore(config.dataDir),
    memory: new FileMemoryStore(config.dataDir),
    payments: new FilePaymentStore(config.dataDir)
  };
}
