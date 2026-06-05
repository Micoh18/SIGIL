import { join } from "node:path";
import { JsonFileStore } from "../storage/json-file-store.js";
import type { PaymentIntentRecord, PaymentReceiptRecord, PaymentStore } from "./types.js";

type PaymentStoreFile = {
  schema_version: "sigil.payment-store.v1";
  intents: PaymentIntentRecord[];
  receipts: PaymentReceiptRecord[];
};

export class FilePaymentStore implements PaymentStore {
  private readonly store: JsonFileStore<PaymentStoreFile>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore({
      filePath: join(dataDir, "payments.json"),
      empty: emptyStore,
      normalize: normalizeStore
    });
  }

  async saveIntent(intent: PaymentIntentRecord): Promise<void> {
    await this.store.update((data) => {
      const existingIndex = data.intents.findIndex((item) => item.id === intent.id);
      if (existingIndex >= 0) {
        data.intents[existingIndex] = intent;
      } else {
        data.intents.push(intent);
      }
    });
  }

  async getIntent(paymentId: string): Promise<PaymentIntentRecord | null> {
    const data = await this.store.read();
    return data.intents.find((intent) => intent.id === paymentId) ?? null;
  }

  async findIntentByIdempotencyKey(
    agentId: string,
    idempotencyKey: string
  ): Promise<PaymentIntentRecord | null> {
    const data = await this.store.read();
    return (
      data.intents.find(
        (intent) => intent.agent_id === agentId && intent.idempotency_key === idempotencyKey
      ) ?? null
    );
  }

  async saveReceipt(receipt: PaymentReceiptRecord): Promise<void> {
    await this.store.update((data) => {
      const existingIndex = data.receipts.findIndex((item) => item.id === receipt.id);
      if (existingIndex >= 0) {
        data.receipts[existingIndex] = receipt;
      } else {
        data.receipts.push(receipt);
      }
    });
  }

  async getReceipt(paymentId: string): Promise<PaymentReceiptRecord | null> {
    const data = await this.store.read();
    return data.receipts.find((receipt) => receipt.payment_id === paymentId) ?? null;
  }
}

function emptyStore(): PaymentStoreFile {
  return {
    schema_version: "sigil.payment-store.v1",
    intents: [],
    receipts: []
  };
}

function normalizeStore(parsed: unknown): PaymentStoreFile {
  const data = asStoreObject(parsed);

  return {
    schema_version: "sigil.payment-store.v1",
    intents: Array.isArray(data.intents) ? (data.intents as PaymentIntentRecord[]) : [],
    receipts: Array.isArray(data.receipts) ? (data.receipts as PaymentReceiptRecord[]) : []
  };
}

function asStoreObject(parsed: unknown): Record<string, unknown> {
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}
